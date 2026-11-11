import { opencodeClient } from "../../opencode/client.js";
import {
  getCurrentSession,
  getSessionReplyReadState,
  setSessionReplyReadState,
} from "../stores/settings-store.js";
import type { SessionReplyReadState } from "../types/settings.js";
import { logger } from "../../utils/logger.js";
import { findEligibleReply, type SessionPickMessage } from "./session-pick-reply.js";

/** How much of a session's tail one request reads, and how far below it the search goes. */
const REPLY_LOOKUP_PAGE_SIZE = 20;
const REPLY_LOOKUP_MAX_PAGES = 5;

/** The completion time replies are compared against: the last shown one, or the upgrade itself. */
function readPosition(state: SessionReplyReadState, sessionId: string): number {
  return Math.max(state.sessions[sessionId]?.readAt ?? 0, state.baselineAt);
}

/** Whether a mark left by an earlier check still stands: the read position does not cover it. */
function isMarked(state: SessionReplyReadState, sessionId: string): boolean {
  const unreadAt = state.sessions[sessionId]?.unreadAt;
  return unreadAt !== undefined && unreadAt > readPosition(state, sessionId);
}

/** The id to continue below, and whether the server answered with a page it had already sent. */
function pageCursor(messages: SessionPickMessage[], before: string | undefined): string | null {
  let oldest: { id: string | undefined; created: number } | null = null;
  for (const message of messages) {
    const created = message.info.time?.created ?? 0;
    if (!oldest || created < oldest.created) {
      oldest = { id: message.info.id, created };
    }
  }
  if (!oldest?.id || oldest.id === before) {
    return null;
  }
  return oldest.id;
}

/**
 * When the session's latest completed text reply finished, or null when none could be read.
 * A reply still streaming does not count: it is not a reply yet, and must not hide the completed
 * one below it. The search walks back a few pages because a reply can sit under a long tail of
 * user messages and tool output. Pages prove nothing on their own — a V2 server filters the
 * entries it returns, so an empty or short page can still have history behind it — and anything
 * they cannot settle falls through to the whole history, which such a server can still hand over.
 */
async function loadLatestCompletedReplyAt(sessionId: string, directory: string): Promise<number | null> {
  let before: string | undefined;

  for (let page = 0; page < REPLY_LOOKUP_MAX_PAGES; page++) {
    const { data, error } = await opencodeClient.session.messages({
      sessionID: sessionId,
      directory,
      limit: REPLY_LOOKUP_PAGE_SIZE,
      ...(before ? { before } : {}),
    });
    if (error || !data) {
      throw error || new Error("No messages received from OpenCode");
    }

    const messages = data as SessionPickMessage[];
    const reply = findEligibleReply(messages, true);
    if (reply?.completed !== undefined) {
      return reply.completed;
    }

    const cursor = pageCursor(messages, before);
    if (cursor === null) {
      break;
    }
    before = cursor;
  }

  const { data, error } = await opencodeClient.session.messages({ sessionID: sessionId, directory });
  if (error || !data) {
    throw error || new Error("No messages received from OpenCode");
  }
  return findEligibleReply(data as SessionPickMessage[], true)?.completed ?? null;
}

/**
 * Records that the chat has shown a session's replies up to `shownAt` — the completion time of the
 * reply that reached it. The position never moves backwards: a newer reply shown earlier stays the
 * newer one.
 */
export function markSessionReplyRead(sessionId: string, shownAt: number): void {
  const state = getSessionReplyReadState();
  if (!state) {
    return;
  }

  const position = state.sessions[sessionId];
  if (position?.readAt !== undefined && position.readAt >= shownAt) {
    return;
  }

  const unreadAt = position?.unreadAt;
  state.sessions[sessionId] = {
    readAt: shownAt,
    ...(unreadAt !== undefined && unreadAt > shownAt ? { unreadAt } : {}),
  };
  void setSessionReplyReadState(state);
}

/**
 * Which of the listed sessions carry a reply the chat has not shown, checked against OpenCode so
 * replies that arrived while the bot was offline count too. The current session is left out: its
 * replies reach the chat live.
 *
 * A check only ever raises a mark or leaves it: the mark comes off when the chat shows the reply
 * (the read position moves past it), never because a lookup could not see it — a lookup reads a
 * bounded tail, may miss a reply buried under later messages, and may fail outright.
 */
export async function loadUnreadReplySessionIds(
  sessions: Array<{ id: string; directory: string }>,
): Promise<Set<string>> {
  const unread = new Set<string>();
  const state = getSessionReplyReadState();
  if (!state) {
    return unread;
  }

  const currentSessionId = getCurrentSession()?.id;
  let changed = false;

  await Promise.all(sessions.map(async ({ id, directory }) => {
    if (id === currentSessionId) {
      return;
    }

    let completedAt: number | null;
    try {
      completedAt = await loadLatestCompletedReplyAt(id, directory);
    } catch (error) {
      logger.warn(`[Recent] Failed to check replies of session ${id}; keeping its known state:`, error);
      if (isMarked(state, id)) {
        unread.add(id);
      }
      return;
    }

    if (completedAt === null) {
      if (isMarked(state, id)) {
        unread.add(id);
      }
      return;
    }

    if (completedAt <= readPosition(state, id)) {
      return;
    }

    unread.add(id);
    if (state.sessions[id]?.unreadAt !== completedAt) {
      state.sessions[id] = { ...state.sessions[id], unreadAt: completedAt };
      changed = true;
    }
  }));

  if (changed) {
    void setSessionReplyReadState(state);
  }
  return unread;
}
