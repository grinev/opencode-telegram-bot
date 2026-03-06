import { CommandContext, Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { opencodeClient } from "../../opencode/client.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { getCurrentSession, updateCurrentSessionTitle } from "../../session/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const RENAME_CALLBACK_CANCEL = "rename:cancel";

interface RenameMetadata {
  flow: "rename";
  stage: "await_title";
  messageId: number;
  sessionId: string;
  directory: string;
  currentTitle: string;
}

function buildRenameKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(t("rename.button.cancel"), RENAME_CALLBACK_CANCEL);
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function parseRenameMetadata(state: InteractionState | null): RenameMetadata | null {
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  const sessionId = state.metadata.sessionId;
  const directory = state.metadata.directory;
  const currentTitle = state.metadata.currentTitle;

  if (
    flow !== "rename" ||
    stage !== "await_title" ||
    typeof messageId !== "number" ||
    typeof sessionId !== "string" ||
    typeof directory !== "string" ||
    typeof currentTitle !== "string"
  ) {
    return null;
  }

  return {
    flow,
    stage,
    messageId,
    sessionId,
    directory,
    currentTitle,
  };
}

function clearRenameInteraction(reason: string): void {
  if (parseRenameMetadata(interactionManager.getSnapshot())) {
    interactionManager.clear(reason);
  }
}

export async function renameCommand(ctx: CommandContext<Context>): Promise<void> {
  const currentSession = getCurrentSession();
  if (!currentSession) {
    await ctx.reply(t("rename.no_active_session"));
    return;
  }

  const message = await ctx.reply(t("rename.prompt", { title: currentSession.title }), {
    reply_markup: buildRenameKeyboard(),
  });

  interactionManager.start({
    kind: "custom",
    expectedInput: "mixed",
    metadata: {
      flow: "rename",
      stage: "await_title",
      messageId: message.message_id,
      sessionId: currentSession.id,
      directory: currentSession.directory,
      currentTitle: currentSession.title,
    },
  });
}

export async function handleRenameCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (data !== RENAME_CALLBACK_CANCEL) {
    return false;
  }

  const metadata = parseRenameMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!metadata || callbackMessageId === null || callbackMessageId !== metadata.messageId) {
    await ctx.answerCallbackQuery({ text: t("rename.inactive_callback"), show_alert: true });
    return true;
  }

  clearRenameInteraction("rename_cancelled");
  await ctx.answerCallbackQuery({ text: t("rename.cancelled_callback") });
  await ctx.deleteMessage().catch(() => {});
  return true;
}

export async function handleRenameText(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }

  const metadata = parseRenameMetadata(interactionManager.getSnapshot());
  if (!metadata) {
    return false;
  }

  const nextTitle = text.trim();
  if (!nextTitle) {
    await ctx.reply(t("rename.empty"));
    return true;
  }

  clearRenameInteraction("rename_submitted");

  if (ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, metadata.messageId).catch(() => {});
  }

  try {
    const { data: session, error } = await opencodeClient.session.update({
      sessionID: metadata.sessionId,
      directory: metadata.directory,
      title: nextTitle,
    });

    if (error || !session) {
      throw error || new Error("No session returned from session.update");
    }

    updateCurrentSessionTitle(metadata.sessionId, session.title);

    try {
      await pinnedMessageManager.onSessionTitleUpdate(session.title);
    } catch (error) {
      logger.error("[Rename] Failed to update pinned session title:", error);
    }

    await ctx.reply(t("rename.success", { title: session.title }));
    return true;
  } catch (error) {
    logger.error("[Rename] Failed to rename session:", error);
    await ctx.reply(t("rename.error"));
    return true;
  }
}
