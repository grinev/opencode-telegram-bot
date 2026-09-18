import { opencodeClient } from "../../opencode/client.js";
import { config } from "../../config.js";
import { extractMessageText } from "../utils/message-text.js";
import { logger } from "../../utils/logger.js";

export interface HistoryEntry {
  role: "user" | "assistant";
  text: string;
  created: number;
}

export interface LoadSessionHistoryResult {
  entries: HistoryEntry[];
  /** Total user+assistant text messages in the session before truncation. */
  totalConversationMessages: number;
}

interface SessionMessageLike {
  info: {
    role?: string;
    summary?: boolean;
    time?: {
      created?: number;
    };
  };
  parts: Array<{ type: string; text?: string }>;
}

/**
 * Loads the full conversation of a session for history rendering.
 *
 * The OpenCode messages endpoint returns ALL messages when `limit` is
 * omitted (the SDK query type only carries an optional `limit`), so no
 * pagination loop is needed.
 *
 * Entries are sorted oldest→newest and truncated to the newest
 * `HISTORY_RENDER_LIMIT` messages (`0` = unlimited, default 200).
 */
export async function loadFullSessionHistory(
  sessionId: string,
  directory: string,
): Promise<LoadSessionHistoryResult> {
  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: sessionId,
      directory,
    });

    if (error || !messages) {
      logger.warn("[History] Failed to fetch session messages:", error);
      return { entries: [], totalConversationMessages: 0 };
    }

    const entries = (messages as SessionMessageLike[])
      .map(({ info, parts }) => {
        const role = info.role as "user" | "assistant" | undefined;
        if (role !== "user" && role !== "assistant") {
          return null;
        }

        if (role === "assistant" && info.summary) {
          return null;
        }

        const text = extractMessageText(parts);
        if (!text) {
          return null;
        }

        return {
          role,
          text,
          created: info.time?.created ?? 0,
        } satisfies HistoryEntry;
      })
      .filter((entry): entry is HistoryEntry => entry !== null)
      .sort((a, b) => a.created - b.created);

    const totalConversationMessages = entries.length;

    const limit = config.bot.historyRenderLimit;
    const truncatedEntries =
      limit > 0 && entries.length > limit ? entries.slice(entries.length - limit) : entries;

    return { entries: truncatedEntries, totalConversationMessages };
  } catch (err) {
    logger.error("[History] Error loading session history:", err);
    return { entries: [], totalConversationMessages: 0 };
  }
}
