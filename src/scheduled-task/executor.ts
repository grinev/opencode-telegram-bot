import { config } from "../config.js";
import { opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";
import type { ScheduledTask, ScheduledTaskExecutionResult } from "./types.js";

const SCHEDULED_TASK_AGENT = "build";
const SCHEDULED_TASK_SESSION_TITLE = "Scheduled task run";
const EXECUTION_POLL_INTERVAL_MS = 2000;
const MAX_IDLE_POLLS_WITHOUT_RESULT = 3;
const MODELS_DOCS_URL = "https://opencode.ai/docs/config/#models";
const EXECUTION_TIMEOUT_ERROR_PREFIX = "Scheduled task exceeded bot execution timeout";

type TextLikePart = { type?: string; text?: string; ignored?: boolean };

type AssistantMessageSnapshot = {
  info: {
    role: string;
    time?: { completed?: number };
    error?: unknown;
  };
  parts: TextLikePart[];
};

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
  messages: Array<{ info: { role: string }; parts: TextLikePart[] }>,
): AssistantMessageSnapshot | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.info.role === "assistant") {
      return message;
    }
  }

  return null;
}

function extractAssistantResult(message: AssistantMessageSnapshot | null): {
  resultText: string | null;
  errorMessage: string | null;
  completed: boolean;
} {
  if (!message) {
    return { resultText: null, errorMessage: null, completed: false };
  }

  const errorMessage = extractErrorMessage(message.info.error);
  if (errorMessage) {
    return {
      resultText: null,
      errorMessage: normalizeScheduledTaskErrorMessage(errorMessage),
      completed: true,
    };
  }

  const resultText = collectResponseText(message.parts);
  return {
    resultText,
    errorMessage: null,
    completed: Boolean(message.info.time?.completed),
  };
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

async function waitForScheduledTaskResult(sessionId: string, directory: string): Promise<string> {
  const startedAtMs = Date.now();
  const executionTimeoutMs = getExecutionTimeoutMs();
  let idlePollsWithoutResult = 0;

  while (true) {
    if (Date.now() - startedAtMs >= executionTimeoutMs) {
      throw new Error(createExecutionTimeoutMessage());
    }

    const assistantResult = await loadAssistantResult(sessionId, directory);

    if (assistantResult.errorMessage) {
      throw new Error(assistantResult.errorMessage);
    }

    if (assistantResult.completed) {
      if (assistantResult.resultText) {
        return assistantResult.resultText;
      }

      throw new Error("Scheduled task returned an empty assistant response");
    }

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

        throw new Error("Scheduled task returned an empty assistant response");
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

  try {
    const { data: session, error: createError } = await opencodeClient.session.create({
      directory: task.projectWorktree,
      title: SCHEDULED_TASK_SESSION_TITLE,
    });

    if (createError || !session) {
      throw createError || new Error("Failed to create temporary scheduled task session");
    }

    sessionId = session.id;

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

    const resultText = await waitForScheduledTaskResult(session.id, session.directory);

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
    if (sessionId) {
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
