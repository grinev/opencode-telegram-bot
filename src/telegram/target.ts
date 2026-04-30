import type { Context } from "grammy";

export interface TelegramTarget {
  chatId: number;
  messageThreadId?: number;
}

export function createTelegramTarget(
  chatId: number,
  messageThreadId?: number | null,
): TelegramTarget {
  if (typeof messageThreadId === "number") {
    return { chatId, messageThreadId };
  }

  return { chatId };
}

export function getTelegramTargetSendOptions(target: TelegramTarget): {
  message_thread_id?: number;
} {
  if (typeof target.messageThreadId === "number") {
    return { message_thread_id: target.messageThreadId };
  }

  return {};
}

export function getMessageThreadIdFromContext(
  ctx: Pick<Context, "message" | "callbackQuery">,
): number | undefined {
  const messageThreadId = (ctx.message as { message_thread_id?: unknown } | undefined)
    ?.message_thread_id;
  if (typeof messageThreadId === "number") {
    return messageThreadId;
  }

  const callbackMessage = ctx.callbackQuery?.message as { message_thread_id?: unknown } | undefined;
  if (typeof callbackMessage?.message_thread_id === "number") {
    return callbackMessage.message_thread_id;
  }

  return undefined;
}

export function getTelegramTargetFromContext(ctx: Context): TelegramTarget | null {
  const chatId = ctx.chat?.id;
  if (typeof chatId !== "number") {
    return null;
  }

  return createTelegramTarget(chatId, getMessageThreadIdFromContext(ctx));
}
