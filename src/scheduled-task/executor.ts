import { config } from "../config.js";
import { t } from "../i18n/index.js";
import { opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";
import {
  cleanupScheduledTaskSessionIgnores,
  registerScheduledTaskSessionIgnore,
} from "./session-ignore.js";
import type { ScheduledTask, ScheduledTaskExecutionResult } from "./types.js";

export const SCHEDULED_TASK_AGENT = "build";
const SCHEDULED_TASK_SESSION_TITLE = "Scheduled task run";
const EXECUTION_POLL_INTERVAL_MS = 2000;
const MAX_IDLE_POLLS_WITHOUT_RESULT = 3;
const COMPLETED_EMPTY_RESULT_RECHECK_INTERVAL_MS = 500;
const MAX_COMPLETED_EMPTY_RESULT_RECHECKS = 3;
const MODELS_DOCS_URL = "https://opencode.ai/docs/config/#models";
const EXECUTION_TIMEOUT_ERROR_PREFIX = "Scheduled task exceeded bot execution timeout";
const INTERACTIVE_PERMISSION_REJECT_MESSAGE =
  "Scheduled task cannot continue because it requires interactive permission.";

type InteractiveRequestKind = "question" | "permission";

type PendingQuestionRequest = {
  id: string;
  sessionID: string;
  questions?: unknown[];
};

type PendingPermissionRequest = {
  id: string;
  sessionID: string;
  permission?: string;
  patterns?: string[];
};

type PendingInteractiveRequest =
  | { kind: "question"; request: PendingQuestionRequest }
  | { kind: "permission"; request: PendingPermissionRequest };

type MessagePartSnapshot = {
  id?: string;
  type?: string;
  text?: string;
  ignored?: boolean;
  tool?: string;
  state?: { status?: string };
};

type TextLikePart = Pick<MessagePartSnapshot, "type" | "text" | "ignored">;

type AssistantMessageSnapshot = {
  info: {
    id?: string;
    role: string;
    summary?: unknown;
    time?: { completed?: number };
    error?: unknown;
  };
  parts: MessagePartSnapshot[];
};

class ScheduledTaskEmptyAssistantResponseError extends Error {
  constructor() {
    super("Scheduled task returned an empty assistant response");
    this.name = "ScheduledTaskEmptyAssistantResponseError";
  }
}

class ScheduledTaskInteractiveRequestError extends Error {
  constructor(kind: InteractiveRequestKind) {
    super(
      t(
        kind === "question"
          ? "task.run.error.interactive_question"
          : "task.run.error.interactive_permission",
      ),
    );
    this.name = "ScheduledTaskInteractiveRequestError";
  }
}

function collectResponseText(parts: TextLikePart[]): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && !part.ignored)
    .map((part) => part.text)
    .join("")
    .trim();
}

function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (!error || typeof error !== "object") {
    return null;
  }

  const typedError = error as {
    message?: unknown;
    name?: unknown;
    data?: { message?: unknown };
  };

  if (typeof typedError.data?.message === "string" && typedError.data.message.trim()) {
    return typedError.data.message.trim();
  }

  if (typeof typedError.message === "string" && typedError.message.trim()) {
    return typedError.message.trim();
  }

  if (typeof typedError.name === "string" && typedError.name.trim()) {
    return typedError.name.trim();
  }

  return null;
}

function isTimeoutErrorMessage(message: string): boolean {
  return /(timed out|timeout|time out|deadline exceeded|request aborted)/i.test(message);
}

function isBotExecutionTimeoutMessage(message: string): boolean {
  return message.startsWith(EXECUTION_TIMEOUT_ERROR_PREFIX);
}

function createExecutionTimeoutMessage(): string {
  return `${EXECUTION_TIMEOUT_ERROR_PREFIX} after ${config.bot.scheduledTaskExecutionTimeoutMinutes} minutes.`;
}

function getExecutionTimeoutMs(): number {
  return config.bot.scheduledTaskExecutionTimeoutMinutes * 60 * 1000;
}

function normalizeScheduledTaskErrorMessage(message: string): string {
  if (
    isBotExecutionTimeoutMessage(message) ||
    !isTimeoutErrorMessage(message) ||
    message.includes(MODELS_DOCS_URL)
  ) {
    return message;
  }

  return `${message} Check OpenCode model timeout settings: ${MODELS_DOCS_URL}`;
}

function toErrorMessage(error: unknown): string {
  const message = extractErrorMessage(error);
  if (message) {
    return normalizeScheduledTaskErrorMessage(message);
  }

  return "Unknown scheduled task execution error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findLatestAssistantMessage(
  messages: Array<{ info: { role: string; summary?: unknown }; parts: MessagePartSnapshot[] }>,
): AssistantMessageSnapshot | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.info.role === "assistant" && !message.info.summary) {
      return message;
    }
  }

  return null;
}

function extractAssistantResult(message: AssistantMessageSnapshot | null): {
  resultText: string | null;
  errorMessage: string | null;
  completed: boolean;
  message: AssistantMessageSnapshot | null;
} {
  if (!message) {
    return { resultText: null, errorMessage: null, completed: false, message: null };
  }

  const errorMessage = extractErrorMessage(message.info.error);
  if (errorMessage) {
    return {
      resultText: null,
      errorMessage: normalizeScheduledTaskErrorMessage(errorMessage),
      completed: true,
      message,
    };
  }

  const resultText = collectResponseText(message.parts);
  return {
    resultText,
    errorMessage: null,
    completed: Boolean(message.info.time?.completed),
    message,
  };
}

function summarizeAssistantParts(parts: MessagePartSnapshot[]): Array<{
  id?: string;
  type?: string;
  ignored?: boolean;
  textLength?: number;
  tool?: string;
  status?: string;
}> {
  return parts.map((part) => ({
    id: part.id,
    type: part.type,
    ignored: part.ignored,
    ...(typeof part.text === "string" ? { textLength: part.text.length } : {}),
    ...(part.tool ? { tool: part.tool } : {}),
    ...(part.state?.status ? { status: part.state.status } : {}),
  }));
}

function logEmptyAssistantResponseDiagnostics(
  taskId: string,
  sessionId: string,
  directory: string,
  message: AssistantMessageSnapshot | null,
  readCount: number,
): void {
  logger.warn("[ScheduledTaskExecutor] Empty completed assistant response diagnostics", {
    taskId,
    sessionId,
    directory,
    readCount,
    assistantMessage: message
      ? {
          id: message.info.id,
          completed: Boolean(message.info.time?.completed),
          summary: Boolean(message.info.summary),
          errorMessage: extractErrorMessage(message.info.error),
          parts: summarizeAssistantParts(message.parts),
        }
      : null,
  });
}

async function loadPendingInteractiveRequest(
  sessionId: string,
  directory: string,
): Promise<PendingInteractiveRequest | null> {
  const [questionsResult, permissionsResult] = await Promise.all([
    opencodeClient.question.list({ directory }),
    opencodeClient.permission.list({ directory }),
  ]);

  if (questionsResult.error) {
    logger.warn(
      `[ScheduledTaskExecutor] Failed to list pending questions: sessionId=${sessionId}`,
      questionsResult.error,
    );
  }

  const question = questionsResult.data?.find((request) => request.sessionID === sessionId);
  if (question) {
    return { kind: "question", request: question };
  }

  if (permissionsResult.error) {
    logger.warn(
      `[ScheduledTaskExecutor] Failed to list pending permissions: sessionId=${sessionId}`,
      permissionsResult.error,
    );
  }

  const permission = permissionsResult.data?.find((request) => request.sessionID === sessionId);
  if (permission) {
    return { kind: "permission", request: permission };
  }

  return null;
}

async function rejectInteractiveRequest(
  request: PendingInteractiveRequest,
  directory: string,
): Promise<void> {
  try {
    if (request.kind === "question") {
      const { error } = await opencodeClient.question.reject({
        requestID: request.request.id,
        directory,
      });

      if (error) {
        logger.warn(
          `[ScheduledTaskExecutor] Failed to reject pending question: requestId=${request.request.id}`,
          error,
        );
      }

      return;
    }

    const { error } = await opencodeClient.permission.reply({
      requestID: request.request.id,
      directory,
      reply: "reject",
      message: INTERACTIVE_PERMISSION_REJECT_MESSAGE,
    });

    if (error) {
      logger.warn(
        `[ScheduledTaskExecutor] Failed to reject pending permission: requestId=${request.request.id}`,
        error,
      );
    }
  } catch (error) {
    logger.warn(
      `[ScheduledTaskExecutor] Failed to reject pending interactive request: requestId=${request.request.id}`,
      error,
    );
  }
}

async function abortScheduledTaskSession(sessionId: string, directory: string): Promise<void> {
  try {
    const { error } = await opencodeClient.session.abort({ sessionID: sessionId, directory });
    if (error) {
      logger.warn(
        `[ScheduledTaskExecutor] Failed to abort interactive scheduled task session: sessionId=${sessionId}`,
        error,
      );
    }
  } catch (error) {
    logger.warn(
      `[ScheduledTaskExecutor] Failed to abort interactive scheduled task session: sessionId=${sessionId}`,
      error,
    );
  }
}

async function failIfInteractiveRequest(
  taskId: string,
  sessionId: string,
  directory: string,
): Promise<void> {
  const interactiveRequest = await loadPendingInteractiveRequest(sessionId, directory);
  if (!interactiveRequest) {
    return;
  }

  logger.warn("[ScheduledTaskExecutor] Scheduled task requested interactive action", {
    taskId,
    sessionId,
    directory,
    kind: interactiveRequest.kind,
    requestId: interactiveRequest.request.id,
    ...(interactiveRequest.kind === "question"
      ? { questionCount: interactiveRequest.request.questions?.length ?? 0 }
      : {
          permission: interactiveRequest.request.permission,
          patterns: interactiveRequest.request.patterns,
        }),
  });

  await rejectInteractiveRequest(interactiveRequest, directory);
  await abortScheduledTaskSession(sessionId, directory);
  throw new ScheduledTaskInteractiveRequestError(interactiveRequest.kind);
}

async function loadAssistantResult(
  sessionId: string,
  directory: string,
): Promise<ReturnType<typeof extractAssistantResult>> {
  const { data: messages, error: messagesError } = await opencodeClient.session.messages({
    sessionID: sessionId,
    directory,
  });

  if (messagesError || !messages) {
    throw messagesError || new Error("Failed to load scheduled task messages");
  }

  return extractAssistantResult(findLatestAssistantMessage(messages));
}

async function waitForScheduledTaskResult(
  taskId: string,
  sessionId: string,
  directory: string,
): Promise<string> {
  const startedAtMs = Date.now();
  const executionTimeoutMs = getExecutionTimeoutMs();
  let idlePollsWithoutResult = 0;
  let completedEmptyResultReadCount = 0;

  while (true) {
    if (Date.now() - startedAtMs >= executionTimeoutMs) {
      throw new Error(createExecutionTimeoutMessage());
    }

    await failIfInteractiveRequest(taskId, sessionId, directory);

    const assistantResult = await loadAssistantResult(sessionId, directory);

    if (assistantResult.errorMessage) {
      throw new Error(assistantResult.errorMessage);
    }

    if (assistantResult.completed) {
      if (assistantResult.resultText) {
        return assistantResult.resultText;
      }

      completedEmptyResultReadCount += 1;
      if (completedEmptyResultReadCount > MAX_COMPLETED_EMPTY_RESULT_RECHECKS) {
        logEmptyAssistantResponseDiagnostics(
          taskId,
          sessionId,
          directory,
          assistantResult.message,
          completedEmptyResultReadCount,
        );
        throw new ScheduledTaskEmptyAssistantResponseError();
      }

      await sleep(COMPLETED_EMPTY_RESULT_RECHECK_INTERVAL_MS);
      continue;
    }

    completedEmptyResultReadCount = 0;

    const { data: statuses, error: statusError } = await opencodeClient.session.status({
      directory,
    });
    if (statusError || !statuses) {
      throw statusError || new Error("Failed to load scheduled task status");
    }

    const sessionStatus = statuses[sessionId];
    if (!sessionStatus || sessionStatus.type === "idle") {
      const confirmedAssistantResult = await loadAssistantResult(sessionId, directory);

      if (confirmedAssistantResult.errorMessage) {
        throw new Error(confirmedAssistantResult.errorMessage);
      }

      if (confirmedAssistantResult.completed) {
        if (confirmedAssistantResult.resultText) {
          return confirmedAssistantResult.resultText;
        }

        completedEmptyResultReadCount += 1;
        if (completedEmptyResultReadCount > MAX_COMPLETED_EMPTY_RESULT_RECHECKS) {
          logEmptyAssistantResponseDiagnostics(
            taskId,
            sessionId,
            directory,
            confirmedAssistantResult.message,
            completedEmptyResultReadCount,
          );
          throw new ScheduledTaskEmptyAssistantResponseError();
        }

        await sleep(COMPLETED_EMPTY_RESULT_RECHECK_INTERVAL_MS);
        continue;
      }

      idlePollsWithoutResult += 1;
      if (idlePollsWithoutResult >= MAX_IDLE_POLLS_WITHOUT_RESULT) {
        throw new Error("Scheduled task finished without a completed assistant response");
      }
    } else {
      idlePollsWithoutResult = 0;
    }

    await sleep(EXECUTION_POLL_INTERVAL_MS);
  }
}

export async function executeScheduledTask(
  task: ScheduledTask,
): Promise<ScheduledTaskExecutionResult> {
  const startedAt = new Date().toISOString();
  let sessionId: string | null = null;
  let deleteTemporarySession = true;

  try {
    await cleanupScheduledTaskSessionIgnores();

    const { data: session, error: createError } = await opencodeClient.session.create({
      directory: task.projectWorktree,
      title: SCHEDULED_TASK_SESSION_TITLE,
    });

    if (createError || !session) {
      throw createError || new Error("Failed to create temporary scheduled task session");
    }

    sessionId = session.id;
    await registerScheduledTaskSessionIgnore(session.id);

    const promptOptions: {
      sessionID: string;
      directory: string;
      parts: Array<{ type: "text"; text: string }>;
      agent: string;
      model?: { providerID: string; modelID: string };
      variant?: string;
    } = {
      sessionID: session.id,
      directory: session.directory,
      parts: [{ type: "text", text: task.prompt }],
      agent: SCHEDULED_TASK_AGENT,
    };

    if (task.model.providerID && task.model.modelID) {
      promptOptions.model = {
        providerID: task.model.providerID,
        modelID: task.model.modelID,
      };
    }

    if (task.model.variant) {
      promptOptions.variant = task.model.variant;
    }

    const { error: promptError } = await opencodeClient.session.promptAsync(promptOptions);

    if (promptError) {
      throw promptError || new Error("Scheduled task prompt execution failed");
    }

    const resultText = await waitForScheduledTaskResult(task.id, session.id, session.directory);

    return {
      taskId: task.id,
      status: "success",
      startedAt,
      finishedAt: new Date().toISOString(),
      resultText,
      errorMessage: null,
    };
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    if (error instanceof ScheduledTaskEmptyAssistantResponseError && sessionId) {
      deleteTemporarySession = false;
      logger.warn(
        `[ScheduledTaskExecutor] Keeping temporary session for inspection: id=${task.id}, sessionId=${sessionId}`,
      );
    }

    logger.warn(
      `[ScheduledTaskExecutor] Task execution failed: id=${task.id}, message=${errorMessage}`,
    );

    return {
      taskId: task.id,
      status: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      resultText: null,
      errorMessage,
    };
  } finally {
    if (sessionId && deleteTemporarySession) {
      try {
        await opencodeClient.session.delete({ sessionID: sessionId });
      } catch (error) {
        logger.warn(
          `[ScheduledTaskExecutor] Failed to delete temporary session: sessionId=${sessionId}`,
          error,
        );
      }
    }
  }
}
