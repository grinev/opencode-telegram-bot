import { InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getDateLocale, t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export const SESSION_CALLBACK_PREFIX = "session:";
export const SESSION_PREVIEW_CALLBACK_PREFIX = "session:preview:";
const SESSION_PAGE_CALLBACK_PREFIX = "session:page:";
const BACKGROUND_SESSION_CALLBACK_PREFIX = "background-session:";
const SESSION_FETCH_EXTRA_COUNT = 1;

export type SessionListItem = {
  id: string;
  title: string;
  directory: string;
  time: {
    created: number;
  };
};

export type SessionPage = {
  sessions: SessionListItem[];
  hasNext: boolean;
  page: number;
};

export type BackgroundSessionOpenKind = "assistant_response" | "question_asked" | "permission_asked";

export interface BackgroundSessionCallbackPayload {
  sessionId: string;
  kind: BackgroundSessionOpenKind | null;
}

const BACKGROUND_SESSION_KIND_CALLBACK_MARKERS: Record<BackgroundSessionOpenKind, string> = {
  assistant_response: "a",
  question_asked: "q",
  permission_asked: "p",
};

const BACKGROUND_SESSION_KIND_BY_CALLBACK_MARKER: Record<string, BackgroundSessionOpenKind> = {
  a: "assistant_response",
  q: "question_asked",
  p: "permission_asked",
};

function buildSessionPageCallback(page: number): string {
  return `${SESSION_PAGE_CALLBACK_PREFIX}${page}`;
}

export function parseSessionPageCallback(data: string): number | null {
  if (!data.startsWith(SESSION_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(SESSION_PAGE_CALLBACK_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

export function parseSessionIdCallback(data: string): string | null {
  if (!data.startsWith(SESSION_CALLBACK_PREFIX)) {
    return null;
  }

  if (data.startsWith(SESSION_PAGE_CALLBACK_PREFIX)) {
    return null;
  }

  const previewSessionId = parseSessionPreviewCallback(data);
  if (previewSessionId) {
    return previewSessionId;
  }

  const sessionId = data.slice(SESSION_CALLBACK_PREFIX.length);
  return sessionId.length > 0 ? sessionId : null;
}

export function parseSessionPreviewCallback(data: string): string | null {
  if (!data.startsWith(SESSION_PREVIEW_CALLBACK_PREFIX)) {
    return null;
  }

  const sessionId = data.slice(SESSION_PREVIEW_CALLBACK_PREFIX.length);
  return sessionId.length > 0 ? sessionId : null;
}

export function parseBackgroundSessionCallback(
  data: string,
): BackgroundSessionCallbackPayload | null {
  if (!data.startsWith(BACKGROUND_SESSION_CALLBACK_PREFIX)) {
    return null;
  }

  const payload = data.slice(BACKGROUND_SESSION_CALLBACK_PREFIX.length);
  const markerSeparatorIndex = payload.indexOf(":");
  if (markerSeparatorIndex < 0) {
    return payload.length > 0 ? { sessionId: payload, kind: null } : null;
  }

  const marker = payload.slice(0, markerSeparatorIndex);
  const sessionId = payload.slice(markerSeparatorIndex + 1);
  const kind = BACKGROUND_SESSION_KIND_BY_CALLBACK_MARKER[marker];
  if (!kind || sessionId.length === 0) {
    return null;
  }

  return { sessionId, kind };
}

export function buildBackgroundSessionOpenKeyboard(
  sessionId: string,
  kind: BackgroundSessionOpenKind,
): InlineKeyboard {
  const marker = BACKGROUND_SESSION_KIND_CALLBACK_MARKERS[kind];
  return new InlineKeyboard().text(
    t("background.open_session_button"),
    `${BACKGROUND_SESSION_CALLBACK_PREFIX}${marker}:${sessionId}`,
  );
}

function formatSessionsSelectText(page: number): string {
  if (page === 0) {
    return t("sessions.select");
  }

  return t("sessions.select_page", { page: page + 1 });
}

export async function loadSessionPage(
  directory: string,
  page: number,
  pageSize: number,
): Promise<SessionPage> {
  const startIndex = page * pageSize;
  const endExclusive = startIndex + pageSize;

  const { data: sessions, error } = await opencodeClient.session.list({
    directory,
    limit: endExclusive + SESSION_FETCH_EXTRA_COUNT,
    roots: true,
  });

  if (error || !sessions) {
    throw error || new Error("No data received from server");
  }

  const hasNext = sessions.length > endExclusive;
  const pagedSessions = sessions.slice(startIndex, endExclusive);

  logger.debug(
    `[Sessions] Loaded page=${page + 1}, startIndex=${startIndex}, endExclusive=${endExclusive}, pageSize=${pageSize}, items=${pagedSessions.length}, hasNext=${hasNext}`,
  );

  return {
    sessions: pagedSessions as SessionListItem[],
    hasNext,
    page,
  };
}

function buildSessionsKeyboard(pageData: SessionPage, pageSize: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const localeForDate = getDateLocale();
  const pageStartIndex = pageData.page * pageSize;

  pageData.sessions.forEach((session, index) => {
    const date = new Date(session.time.created).toLocaleDateString(localeForDate);
    const label = `${pageStartIndex + index + 1}. ${session.title} (${date})`;
    keyboard.text(label, `${SESSION_PREVIEW_CALLBACK_PREFIX}${session.id}`).row();
  });

  if (pageData.page > 0) {
    keyboard.text(t("sessions.button.prev_page"), buildSessionPageCallback(pageData.page - 1));
  }

  if (pageData.hasNext) {
    keyboard.text(t("sessions.button.next_page"), buildSessionPageCallback(pageData.page + 1));
  }

  if (pageData.page > 0 || pageData.hasNext) {
    keyboard.row();
  }

  return keyboard;
}

export function buildSessionSelectionMenuView(
  pageData: SessionPage,
  pageSize: number,
): { text: string; keyboard: InlineKeyboard } {
  return {
    text: formatSessionsSelectText(pageData.page),
    keyboard: buildSessionsKeyboard(pageData, pageSize),
  };
}
