import type { Context } from "grammy";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { generateCommitMessage } from "../../app/services/commit-message-service.js";
import { commitAll } from "../../app/services/git-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import {
  COMMIT_CANCEL_CALLBACK,
  COMMIT_CONFIRM_CALLBACK,
  COMMIT_EDIT_CALLBACK,
  COMMIT_FLOW,
  COMMIT_REGENERATE_CALLBACK,
  showCommitConfirmation,
} from "../menus/commit-menu.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";

interface CommitFlowMetadata {
  stage: string;
  dir: string;
  message: string;
  messageId?: number;
}

function parseCommitMetadata(): CommitFlowMetadata | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom" || state.metadata.flow !== COMMIT_FLOW) {
    return null;
  }

  const stage = state.metadata.stage;
  const dir = state.metadata.dir;
  const message = state.metadata.message;

  if (typeof stage !== "string" || typeof dir !== "string" || typeof message !== "string") {
    return null;
  }

  const messageId =
    typeof state.metadata.messageId === "number" ? state.metadata.messageId : undefined;

  return { stage, dir, message, messageId };
}

export async function handleCommitCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("commit:")) {
    return false;
  }

  const meta = parseCommitMetadata();
  if (!meta || meta.stage !== "confirm") {
    await ctx
      .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
      .catch(() => {});
    return true;
  }

  // Reject stale callbacks from older confirmation messages.
  const callbackMessageId = ctx.callbackQuery?.message?.message_id;
  if (meta.messageId !== undefined && callbackMessageId !== meta.messageId) {
    await ctx
      .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
      .catch(() => {});
    return true;
  }

  try {
    if (data === COMMIT_CANCEL_CALLBACK) {
      interactionManager.clear("commit_cancelled");
      await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data === COMMIT_CONFIRM_CALLBACK) {
      await ctx.answerCallbackQuery().catch(() => {});

      try {
        const { hash } = await commitAll(meta.dir, meta.message);
        interactionManager.clear("commit_done");
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply(t("commit.success", { hash, message: meta.message }));
        await pinnedMessageManager.refresh().catch(() => {});
      } catch (error) {
        logger.error("[CommitHandler] git commit failed:", error);
        interactionManager.clear("commit_failed");
        await ctx.reply(t("commit.error"));
      }

      return true;
    }

    if (data === COMMIT_REGENERATE_CALLBACK) {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.deleteMessage().catch(() => {});

      const generatingMessage = await ctx.reply(t("commit.generating"));
      const result = await generateCommitMessage(meta.dir);
      await ctx.api
        .deleteMessage(generatingMessage.chat.id, generatingMessage.message_id)
        .catch(() => {});

      await showCommitConfirmation(ctx, meta.dir, result.message, result.generated);
      return true;
    }

    if (data === COMMIT_EDIT_CALLBACK) {
      await ctx.answerCallbackQuery().catch(() => {});

      interactionManager.transition({
        expectedInput: "text",
        metadata: {
          flow: COMMIT_FLOW,
          stage: "edit",
          dir: meta.dir,
          message: meta.message,
          messageId: meta.messageId,
        },
      });

      await ctx.reply(t("commit.edit_prompt"));
      return true;
    }

    return false;
  } catch (error) {
    logger.error("[CommitHandler] Error handling commit callback:", error);
    interactionManager.clear("commit_handler_error");
    await ctx.reply(t("commit.error")).catch(() => {});
    return true;
  }
}

/**
 * Text-input step of the commit flow: the user's message becomes the commit
 * message and the confirmation is shown again.
 */
export async function handleCommitEditTextInput(ctx: Context): Promise<boolean> {
  const meta = parseCommitMetadata();
  if (!meta || meta.stage !== "edit") {
    return false;
  }

  const text = ctx.message?.text?.trim();
  if (!text) {
    return false;
  }

  await showCommitConfirmation(ctx, meta.dir, text, true);
  return true;
}
