import { opencodeV2Client } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import {
  promptQueue,
  type QueuedPrompt,
  type QueuedPromptInbox,
} from "../managers/prompt-queue-manager.js";

export type InboxWithdrawResult = "removed" | "gone" | "failed";

/**
 * Withdraws one mirrored prompt from the OpenCode V2 session inbox. OpenCode answers a
 * cancel of an already delivered prompt with success too, so the inbox list decides
 * whether the prompt was still waiting.
 */
export async function withdrawInboxPrompt(item: QueuedPrompt): Promise<InboxWithdrawResult> {
  const inbox = item.inbox;
  if (!inbox) {
    return "failed";
  }

  try {
    const { data: waitingIds, error: listError } = await opencodeV2Client.session.inbox.list({
      sessionID: inbox.sessionId,
    });
    if (listError || !waitingIds) {
      logger.warn(`[PromptInbox] Failed to list inbox: session=${inbox.sessionId}`, listError);
      return "failed";
    }

    if (!waitingIds.includes(inbox.inboxId)) {
      promptQueue.removeById(item.id);
      logger.info(`[PromptInbox] Prompt already left the inbox: inboxId=${inbox.inboxId}`);
      return "gone";
    }

    const { error: cancelError } = await opencodeV2Client.session.inbox.cancel({
      sessionID: inbox.sessionId,
      inboxID: inbox.inboxId,
    });
    if (cancelError) {
      logger.warn(
        `[PromptInbox] Failed to cancel inbox prompt: inboxId=${inbox.inboxId}`,
        cancelError,
      );
      return "failed";
    }

    promptQueue.removeById(item.id);
    logger.info(`[PromptInbox] Withdrew inbox prompt: inboxId=${inbox.inboxId}`);
    return "removed";
  } catch (err) {
    logger.warn(`[PromptInbox] Failed to withdraw inbox prompt: inboxId=${inbox.inboxId}`, err);
    return "failed";
  }
}

/** Cancels a prompt in the OpenCode V2 session inbox; failures are logged, not thrown. */
export async function cancelInboxPrompt(inbox: QueuedPromptInbox, reason: string): Promise<void> {
  try {
    const { error } = await opencodeV2Client.session.inbox.cancel({
      sessionID: inbox.sessionId,
      inboxID: inbox.inboxId,
    });
    if (error) {
      logger.warn(
        `[PromptInbox] Failed to cancel inbox prompt: inboxId=${inbox.inboxId}, reason=${reason}`,
        error,
      );
      return;
    }
    logger.info(`[PromptInbox] Cancelled inbox prompt: inboxId=${inbox.inboxId}, reason=${reason}`);
  } catch (err) {
    logger.warn(
      `[PromptInbox] Failed to cancel inbox prompt: inboxId=${inbox.inboxId}, reason=${reason}`,
      err,
    );
  }
}

/**
 * Clears the prompt queue and withdraws every prompt still waiting in the OpenCode V2
 * inbox. Admissions still on their way lose their reservation and cancel themselves.
 */
export async function withdrawPromptQueue(reason: string): Promise<void> {
  const removed = promptQueue.clear(reason);
  await Promise.all(
    removed.flatMap((item) => (item.inbox ? [cancelInboxPrompt(item.inbox, reason)] : [])),
  );
}

/** Drops mirrored prompts that no longer wait in the session inbox (missed pickup or cancel). */
export async function reconcileInboxPrompts(sessionId: string): Promise<void> {
  const mirrored = promptQueue.list().filter((item) => item.inbox?.sessionId === sessionId);
  if (mirrored.length === 0) {
    return;
  }

  try {
    const { data: waitingIds, error } = await opencodeV2Client.session.inbox.list({
      sessionID: sessionId,
    });
    if (error || !waitingIds) {
      logger.warn(`[PromptInbox] Failed to list inbox for reconcile: session=${sessionId}`, error);
      return;
    }

    for (const item of mirrored) {
      if (item.inbox && !waitingIds.includes(item.inbox.inboxId)) {
        promptQueue.removeById(item.id);
        logger.info(`[PromptInbox] Dropped stale inbox mirror: inboxId=${item.inbox.inboxId}`);
      }
    }
  } catch (err) {
    logger.warn(`[PromptInbox] Failed to reconcile inbox: session=${sessionId}`, err);
  }
}
