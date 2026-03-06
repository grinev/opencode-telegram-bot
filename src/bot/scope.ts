import type { Context } from "grammy";
import { CHAT_TYPE } from "./constants.js";

export const GLOBAL_SCOPE_KEY = "global";

export const SCOPE_CONTEXT = {
  DM: "dm",
  GROUP_GENERAL: "group-general",
  GROUP_TOPIC: "group-topic",
} as const;

export type ScopeContextKind = (typeof SCOPE_CONTEXT)[keyof typeof SCOPE_CONTEXT];

const DM_SCOPE_PREFIX = "dm:";
const GROUP_SCOPE_PREFIX = "chat:";
export const GENERAL_TOPIC_THREAD_ID = 1;

export interface ScopeParams {
  chatId: number;
  threadId?: number;
  context: ScopeContextKind;
}

export interface ConversationScope {
  key: string;
  chatId: number;
  threadId: number | null;
  context: ScopeContextKind;
}

type KnownChatType = (typeof CHAT_TYPE)[keyof typeof CHAT_TYPE];

function isKnownChatType(type: unknown): type is KnownChatType {
  return (
    type === CHAT_TYPE.PRIVATE ||
    type === CHAT_TYPE.GROUP ||
    type === CHAT_TYPE.SUPERGROUP ||
    type === CHAT_TYPE.CHANNEL
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNullableThreadId(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeContextForLegacyInput(
  chatId: number,
  threadId: number | null,
  chatType?: KnownChatType,
): ScopeParams {
  if (chatType === CHAT_TYPE.PRIVATE) {
    return {
      chatId,
      context: SCOPE_CONTEXT.DM,
    };
  }

  if (threadId === null) {
    return {
      chatId,
      context: SCOPE_CONTEXT.GROUP_GENERAL,
    };
  }

  return {
    chatId,
    threadId,
    context:
      threadId === GENERAL_TOPIC_THREAD_ID
        ? SCOPE_CONTEXT.GROUP_GENERAL
        : SCOPE_CONTEXT.GROUP_TOPIC,
  };
}

function buildScopeKey(params: ScopeParams): string {
  if (params.context === SCOPE_CONTEXT.DM) {
    return `${DM_SCOPE_PREFIX}${params.chatId}`;
  }

  if (typeof params.threadId === "number") {
    return `${params.chatId}:${params.threadId}`;
  }

  return `${GROUP_SCOPE_PREFIX}${params.chatId}`;
}

export function parseScopeKey(scopeKey: string): ScopeParams | null {
  if (!scopeKey || scopeKey === GLOBAL_SCOPE_KEY) {
    return null;
  }

  const directTopicMatch = /^(-?\d+):(\d+)$/.exec(scopeKey);
  if (directTopicMatch) {
    const chatId = Number.parseInt(directTopicMatch[1], 10);
    const threadId = Number.parseInt(directTopicMatch[2], 10);
    return {
      chatId,
      threadId,
      context:
        threadId === GENERAL_TOPIC_THREAD_ID
          ? SCOPE_CONTEXT.GROUP_GENERAL
          : SCOPE_CONTEXT.GROUP_TOPIC,
    };
  }

  const legacyTopicMatch = /^chat:(-?\d+):(\d+)$/.exec(scopeKey);
  if (legacyTopicMatch) {
    const chatId = Number.parseInt(legacyTopicMatch[1], 10);
    const threadId = Number.parseInt(legacyTopicMatch[2], 10);
    return {
      chatId,
      threadId,
      context:
        threadId === GENERAL_TOPIC_THREAD_ID
          ? SCOPE_CONTEXT.GROUP_GENERAL
          : SCOPE_CONTEXT.GROUP_TOPIC,
    };
  }

  const dmMatch = /^dm:(\d+)$/.exec(scopeKey);
  if (dmMatch) {
    return {
      chatId: Number.parseInt(dmMatch[1], 10),
      context: SCOPE_CONTEXT.DM,
    };
  }

  const groupGeneralMatch = /^chat:(-?\d+)$/.exec(scopeKey);
  if (groupGeneralMatch) {
    return {
      chatId: Number.parseInt(groupGeneralMatch[1], 10),
      context: SCOPE_CONTEXT.GROUP_GENERAL,
    };
  }

  return null;
}

export function createScopeKey(
  chatId: number,
  threadId: number | null,
  chatType?: KnownChatType,
): string {
  if (!chatType && threadId === null) {
    return GLOBAL_SCOPE_KEY;
  }

  return buildScopeKey(normalizeContextForLegacyInput(chatId, threadId, chatType));
}

export function createScopeKeyFromParams(params: ScopeParams): string {
  return buildScopeKey(params);
}

function extractThreadIdFromMessage(message: {
  is_topic_message?: boolean;
  message_thread_id?: number;
}): number | null {
  const parsed = toNullableThreadId(message.message_thread_id);
  if (parsed !== null) {
    return parsed;
  }

  if (message.is_topic_message) {
    return GENERAL_TOPIC_THREAD_ID;
  }

  return null;
}

function getContextPayloadThreadId(ctx: Context): number | null {
  if (ctx.message) {
    return extractThreadIdFromMessage(ctx.message);
  }

  if (ctx.callbackQuery && "message" in ctx.callbackQuery) {
    return extractThreadIdFromMessage(ctx.callbackQuery.message as { message_thread_id?: number });
  }

  const callbackMessage = isObject(ctx.callbackQuery)
    ? Reflect.get(ctx.callbackQuery, "message")
    : undefined;
  if (isObject(callbackMessage)) {
    return toNullableThreadId(Reflect.get(callbackMessage, "message_thread_id"));
  }

  return null;
}

function resolveScopeContext(
  chatType: KnownChatType | undefined,
  threadId: number | null,
): ScopeContextKind {
  if (chatType === CHAT_TYPE.PRIVATE) {
    return SCOPE_CONTEXT.DM;
  }

  if (threadId === null || threadId === GENERAL_TOPIC_THREAD_ID) {
    return SCOPE_CONTEXT.GROUP_GENERAL;
  }

  return SCOPE_CONTEXT.GROUP_TOPIC;
}

export function getScopeFromContext(ctx: Context): ConversationScope | null {
  if (!ctx.chat) {
    return null;
  }

  const threadId = getContextPayloadThreadId(ctx);
  const chatType = isKnownChatType(ctx.chat.type) ? ctx.chat.type : undefined;
  if (!chatType) {
    if (threadId === null) {
      return null;
    }

    const fallbackContext =
      threadId === GENERAL_TOPIC_THREAD_ID
        ? SCOPE_CONTEXT.GROUP_GENERAL
        : SCOPE_CONTEXT.GROUP_TOPIC;

    return {
      key: createScopeKeyFromParams({
        chatId: ctx.chat.id,
        threadId,
        context: fallbackContext,
      }),
      chatId: ctx.chat.id,
      threadId,
      context: fallbackContext,
    };
  }

  const context = resolveScopeContext(chatType, threadId);

  const key = createScopeKeyFromParams({
    chatId: ctx.chat.id,
    threadId: threadId ?? undefined,
    context,
  });

  return {
    key,
    chatId: ctx.chat.id,
    threadId,
    context,
  };
}

export function getScopeKeyFromContext(ctx: Context): string {
  return getScopeFromContext(ctx)?.key ?? GLOBAL_SCOPE_KEY;
}

export function getScopeFromKey(scopeKey: string): ConversationScope | null {
  const parsed = parseScopeKey(scopeKey);
  if (!parsed) {
    return null;
  }

  return {
    key: buildScopeKey(parsed),
    chatId: parsed.chatId,
    threadId: typeof parsed.threadId === "number" ? parsed.threadId : null,
    context: parsed.context,
  };
}

export function getThreadIdFromScopeKey(scopeKey: string): number | null {
  return getScopeFromKey(scopeKey)?.threadId ?? null;
}

export function getMessageThreadId(threadId: number | null): number | null {
  if (threadId === null || threadId === GENERAL_TOPIC_THREAD_ID) {
    return null;
  }

  return threadId;
}

export function getThreadSendOptions(threadId: number | null): { message_thread_id?: number } {
  const messageThreadId = getMessageThreadId(threadId);
  if (messageThreadId === null) {
    return {};
  }

  return { message_thread_id: messageThreadId };
}

export function getChatActionThreadOptions(threadId: number | null): {
  message_thread_id?: number;
} {
  if (threadId === null) {
    return {};
  }

  return { message_thread_id: threadId };
}

export function isGeneralScope(scope: ConversationScope | null): boolean {
  return scope?.context === SCOPE_CONTEXT.GROUP_GENERAL;
}

export function isTopicScope(scope: ConversationScope | null): boolean {
  return scope?.context === SCOPE_CONTEXT.GROUP_TOPIC;
}
