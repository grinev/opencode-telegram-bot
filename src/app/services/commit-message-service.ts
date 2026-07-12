import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { getChangedFiles, getDiffStat, getFullPatch } from "./git-service.js";
import { getStoredModel } from "./model-selection-service.js";
import { registerScheduledTaskSessionIgnore } from "./scheduled-task-session-ignore-service.js";

const MAX_DIFF_PROMPT_LENGTH = 8000;
const COMMIT_SESSION_TITLE = "Telegram bot: commit message generation";

const COMMIT_MESSAGE_PROMPT =
  "Write a concise git commit message in conventional-commit style for the changes below. " +
  "Reply with the commit message only — no explanations, no code fences, no surrounding quotes.";

export interface CommitMessageResult {
  message: string;
  generated: boolean;
}

function sanitizeGeneratedMessage(text: string): string {
  return text
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

async function buildFallbackMessage(dir: string): Promise<string> {
  try {
    const files = await getChangedFiles(dir);
    return `chore: update ${files.length} file${files.length === 1 ? "" : "s"}`;
  } catch {
    return "chore: update files";
  }
}

/**
 * Run one prompt on a fresh throwaway session and return the sanitized text.
 * The session is registered as ignored (kept out of background tracking) and
 * always deleted afterwards.
 */
async function promptOnThrowawaySession(
  dir: string,
  promptText: string,
  model?: { providerID: string; modelID: string },
): Promise<string> {
  let sessionId: string | null = null;

  try {
    const { data: session, error: createError } = await opencodeClient.session.create({
      directory: dir,
      title: COMMIT_SESSION_TITLE,
    });

    if (createError || !session) {
      throw createError || new Error("Failed to create commit-message session");
    }

    sessionId = session.id;
    await registerScheduledTaskSessionIgnore(session.id);

    const promptOptions: {
      sessionID: string;
      directory: string;
      parts: Array<{ type: "text"; text: string }>;
      model?: { providerID: string; modelID: string };
    } = {
      sessionID: session.id,
      directory: session.directory,
      parts: [{ type: "text", text: promptText }],
    };

    if (model) {
      promptOptions.model = model;
    }

    const { data, error } = await opencodeClient.session.prompt(promptOptions);

    if (error || !data) {
      throw error || new Error("Commit-message prompt returned no data");
    }

    const text = data.parts
      .filter((part): part is typeof part & { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    const message = sanitizeGeneratedMessage(text);
    if (!message) {
      throw new Error("Commit-message prompt returned empty text");
    }

    return message;
  } finally {
    if (sessionId) {
      try {
        await opencodeClient.session.delete({ sessionID: sessionId });
      } catch (error) {
        logger.warn(
          `[CommitMessage] Failed to delete temporary session: sessionId=${sessionId}`,
          error,
        );
      }
    }
  }
}

/**
 * Generate a commit message for the worktree changes by prompting OpenCode
 * on a throwaway session. A stale or misconfigured stored model must not
 * break generation: on failure the prompt is retried on a NEW session without
 * an explicit model (a session remembers the model of its previous message,
 * so retrying inside the same session would inherit the broken model).
 * Falls back to a deterministic message when OpenCode is unavailable.
 */
export async function generateCommitMessage(dir: string): Promise<CommitMessageResult> {
  let promptText: string;
  try {
    const stat = await getDiffStat(dir);
    const patch = (await getFullPatch(dir)).slice(0, MAX_DIFF_PROMPT_LENGTH);
    promptText = `${COMMIT_MESSAGE_PROMPT}\n\nDiff stat:\n${stat}\n\nDiff:\n${patch}`;
  } catch (error) {
    logger.warn("[CommitMessage] Failed to read git diff, using fallback message:", error);
    return { message: await buildFallbackMessage(dir), generated: false };
  }

  const storedModel = getStoredModel();
  const model =
    storedModel.providerID && storedModel.modelID
      ? { providerID: storedModel.providerID, modelID: storedModel.modelID }
      : undefined;

  try {
    const message = await promptOnThrowawaySession(dir, promptText, model);
    return { message, generated: true };
  } catch (error) {
    if (!model) {
      logger.warn("[CommitMessage] Generation failed, using fallback message:", error);
      return { message: await buildFallbackMessage(dir), generated: false };
    }

    logger.warn(
      `[CommitMessage] Prompt with model ${model.providerID}/${model.modelID} failed, retrying with server default:`,
      error,
    );
  }

  try {
    const message = await promptOnThrowawaySession(dir, promptText);
    return { message, generated: true };
  } catch (error) {
    logger.warn("[CommitMessage] Generation failed, using fallback message:", error);
    return { message: await buildFallbackMessage(dir), generated: false };
  }
}
