import { Context, InlineKeyboard } from "grammy";
import { randomUUID } from "node:crypto";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import type { InteractionMetadata, InteractionState } from "../../app/types/interaction.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export const INLINE_MENU_CANCEL_PREFIX = "inline:cancel:";
export const LEGACY_CONTEXT_CANCEL_CALLBACK = "compact:cancel";

const INLINE_MENU_KINDS = [
  "project",
  "session",
  "model",
  "agent",
  "variant",
  "context",
  "open",
  "ls",
  "worktree",
  "settings",
] as const;

export type InlineMenuKind = (typeof INLINE_MENU_KINDS)[number];

interface ActiveInlineMenuMetadata {
  menuKind: InlineMenuKind;
  messageId: number;
}

interface InlineMenuReplyOptions {
  menuKind: InlineMenuKind;
  text: string;
  keyboard: InlineKeyboard;
  parseMode?: "Markdown" | "HTML";
  metadata?: InteractionMetadata;
}

export function isInlineMenuKind(value: string): value is InlineMenuKind {
  return INLINE_MENU_KINDS.includes(value as InlineMenuKind);
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) {
    return null;
  }

  const messageId = (message as { message_id?: number }).message_id;
  return typeof messageId === "number" ? messageId : null;
}

function getActiveInlineMenuMetadata(
  state: InteractionState | null,
): ActiveInlineMenuMetadata | null {
  if (!state || state.kind !== "inline") {
    return null;
  }

  const menuKind = state.metadata.menuKind;
  const messageId = state.metadata.messageId;

  if (typeof menuKind !== "string" || !isInlineMenuKind(menuKind)) {
    return null;
  }

  if (typeof messageId !== "number") {
    return null;
  }

  return {
    menuKind,
    messageId,
  };
}

function getInlineCancelCallbackData(menuKind: InlineMenuKind): string {
  return `${INLINE_MENU_CANCEL_PREFIX}${menuKind}`;
}

export function appendInlineMenuCancelButton(
  keyboard: InlineKeyboard,
  menuKind: InlineMenuKind,
): InlineKeyboard {
  while (keyboard.inline_keyboard.length > 0) {
    const lastRow = keyboard.inline_keyboard[keyboard.inline_keyboard.length - 1];
    if (!lastRow || lastRow.length > 0) {
      break;
    }
    keyboard.inline_keyboard.pop();
  }

  if (keyboard.inline_keyboard.length > 0) {
    keyboard.row();
  }

  const buttonText = menuKind === "settings" ? t("inline.button.close") : t("inline.button.cancel");
  keyboard.text(buttonText, getInlineCancelCallbackData(menuKind));
  return keyboard;
}

export async function replyWithInlineMenu(
  ctx: Context,
  options: InlineMenuReplyOptions,
): Promise<number | null> {
  const keyboard = appendInlineMenuCancelButton(options.keyboard, options.menuKind);
  const reservationId = randomUUID();
  const reserved = interactionManager.tryStart({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      ...options.metadata,
      menuKind: options.menuKind,
      reservationId,
    },
  });
  if (!reserved) {
    await ctx.reply(t("interaction.blocked.finish_current"));
    return null;
  }

  const replyOptions: {
    reply_markup: InlineKeyboard;
    parse_mode?: "Markdown" | "HTML";
  } = {
    reply_markup: keyboard,
  };

  if (options.parseMode) {
    replyOptions.parse_mode = options.parseMode;
  }

  let message;
  try {
    message = await ctx.reply(options.text, replyOptions);
  } catch (error) {
    interactionManager.clearIfMetadata("reservationId", reservationId, "inline_send_failed");
    throw error;
  }

  const finalized = interactionManager.transitionIfMetadata("reservationId", reservationId, {
    metadata: {
      ...options.metadata,
      menuKind: options.menuKind,
      messageId: message.message_id,
    },
  });
  if (!finalized) {
    if (ctx.chat) {
      await ctx.api.editMessageReplyMarkup(ctx.chat.id, message.message_id).catch(() => {});
    }
    return null;
  }

  logger.debug(
    `[InlineMenu] Opened menu: kind=${options.menuKind}, messageId=${message.message_id}`,
  );

  return message.message_id;
}

export async function ensureActiveInlineMenu(
  ctx: Context,
  menuKind: InlineMenuKind,
): Promise<boolean> {
  const activeMetadata = getActiveInlineMenuMetadata(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  const isActive =
    !!activeMetadata &&
    callbackMessageId !== null &&
    activeMetadata.menuKind === menuKind &&
    activeMetadata.messageId === callbackMessageId;

  if (isActive) {
    return true;
  }

  logger.debug(
    `[InlineMenu] Stale callback ignored: expectedKind=${menuKind}, activeKind=${activeMetadata?.menuKind || "none"}, callbackMessageId=${callbackMessageId || "none"}, activeMessageId=${activeMetadata?.messageId || "none"}`,
  );

  await ctx
    .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
    .catch(() => {});

  return false;
}

export function clearActiveInlineMenu(reason: string): void {
  const state = interactionManager.getSnapshot();
  if (state?.kind === "inline") {
    interactionManager.clear(reason);
  }
}
