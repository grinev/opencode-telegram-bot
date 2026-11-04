import { InlineKeyboard } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getDateLocale, t } from "../../i18n/index.js";
import { formatSessionTitle } from "../../app/formatters/session-title-formatter.js";
import { logger } from "../../utils/logger.js";
import {
  collectFromPresentFolders,
  findMissingFolders,
} from "../../app/services/folder-presence-service.js";
import { getCurrentSession } from "../../app/stores/settings-store.js";

export const SESSION_CALLBACK_PREFIX = "session:";
/** A session title never approaches this; the cap keeps a typed query sendable. */
export const SESSION_SEARCH_QUERY_MAX_LENGTH = 100;
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

  const sessionId = data.slice(SESSION_CALLBACK_PREFIX.length);
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

  // Sessions whose folder is gone are left out before the list is split into pages.
  const sessions = await collectFromPresentFolders(
    async (limit) => {
      const { data, error } = await opencodeClient.session.list({ directory, limit, roots: true });
      if (error || !data) {
        throw error || new Error("No data received from server");
      }
      return data;
    },
    (session) => session.directory,
    endExclusive + SESSION_FETCH_EXTRA_COUNT,
  );

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

export async function searchSessions(directory: string, query: string): Promise<SessionListItem[]> {
  const { data, error } = await opencodeClient.session.list({ directory, roots: true });
  if (error || !data) throw error || new Error("No data received from server");
  const missing = await findMissingFolders(data.map((session) => session.directory));
  const needle = query.trim().toLowerCase();
  return data.filter(
    (session) =>
      !missing.has(session.directory) &&
      (formatSessionTitle(session.title).toLowerCase().includes(needle) ||
        session.id.toLowerCase().includes(needle)),
  ) as SessionListItem[];
}

function buildSessionsKeyboard(
  pageData: SessionPage,
  pageSize: number,
  search = false,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const localeForDate = getDateLocale();
  const pageStartIndex = pageData.page * pageSize;
  const currentId = getCurrentSession()?.id;

  if (!search) keyboard.text(t("sessions.search.button"), "session:search").row();

  pageData.sessions.forEach((session, index) => {
    const date = new Date(session.time.created).toLocaleDateString(localeForDate);
    const marker = session.id === currentId ? `${t("sessions.current_marker")} ` : "";
    const label = `${pageStartIndex + index + 1}. ${marker}${formatSessionTitle(session.title)} (${date})`;
    keyboard
      .text(
        label,
        search
          ? `session:search:result:${pageStartIndex + index}`
          : `${SESSION_CALLBACK_PREFIX}${session.id}`,
      )
      .row();
  });

  if (pageData.page > 0) {
    keyboard.text(
      t("sessions.button.prev_page"),
      search
        ? `session:search:page:${pageData.page - 1}`
        : buildSessionPageCallback(pageData.page - 1),
    );
  }

  if (pageData.hasNext) {
    keyboard.text(
      t("sessions.button.next_page"),
      search
        ? `session:search:page:${pageData.page + 1}`
        : buildSessionPageCallback(pageData.page + 1),
    );
  }

  if (pageData.page > 0 || pageData.hasNext) {
    keyboard.row();
  }

  return keyboard;
}

export function buildSessionSearchView(
  sessions: SessionListItem[],
  query: string,
  page: number,
  pageSize: number,
) {
  const start = page * pageSize;
  const keyboard = buildSessionsKeyboard(
    {
      sessions: sessions.slice(start, start + pageSize),
      page,
      hasNext: sessions.length > start + pageSize,
    },
    pageSize,
    true,
  );
  keyboard
    .text(t("sessions.search.again"), "session:search:again")
    .text(t("sessions.search.cancel"), "session:search:cancel");
  const text =
    sessions.length === 0
      ? t("sessions.search.no_results", { query })
      : page === 0
        ? t("sessions.search.results", { query })
        : t("sessions.search.results_page", { query, page: page + 1 });
  return { text, keyboard };
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
