import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { promptAttachment } from "../../app/managers/prompt-attachment-manager.js";
import { logger } from "../../utils/logger.js";
import { cancelPrompt } from "./feedback.js";

export const ATTACHMENT_CANCEL_CALLBACK = "attach:cancel";

export type PromptAttachmentCancelDeps = Pick<AppContainer, "interactionManager">;

export async function handlePromptAttachmentCancel(
  ctx: Context,
  deps: PromptAttachmentCancelDeps,
): Promise<boolean> {
  if (ctx.callbackQuery?.data !== ATTACHMENT_CANCEL_CALLBACK) {
    return false;
  }

  promptAttachment.clear("user_cancelled");
  deps.interactionManager.clear("attachment_cancelled");

  await cancelPrompt(ctx, "attachment.cancelled");

  logger.debug("[PromptAttachment] Attachment cancelled by user");

  return true;
}
