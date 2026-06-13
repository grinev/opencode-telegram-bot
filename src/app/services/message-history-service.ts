import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";

const LATEST_ASSISTANT_RESPONSE_MESSAGES_LIMIT = 20;

export interface UserMessageItem {
  id: string;
  text: string;
  created: number;
}

type SessionMessageLike = {
  info: {
    id?: string;
    role?: string;
    summary?: boolean;
    time?: {
      created?: number;
    };
  };
  parts: Array<{ type: string; text?: string }>;
};

function extractTextParts(parts: Array<{ type: string; text?: string }>): string | null {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}

export async function loadUserMessages(
  sessionId: string,
  directory: string,
): Promise<UserMessageItem[]> {
  const { data, error } = await opencodeClient.session.messages({
    sessionID: sessionId,
    directory,
  });

  if (error || !data) {
    throw error || new Error("No message data received");
  }

  const { data: sessionData } = await opencodeClient.session.get({
    sessionID: sessionId,
    directory,
  });

  const revertMessageID = sessionData?.revert?.messageID;

  const messages = (data as SessionMessageLike[])
    .map((message) => {
      if (message.info.role !== "user") {
        return null;
      }

      const text = extractTextParts(message.parts);
      if (!text) {
        return null;
      }

      return {
        id: message.info.id ?? `${message.info.time?.created ?? 0}`,
        text,
        created: message.info.time?.created ?? 0,
      } satisfies UserMessageItem;
    })
    .filter((message): message is UserMessageItem => Boolean(message))
    .sort((a, b) => b.created - a.created);

  if (revertMessageID) {
    const revertIndex = messages.findIndex((msg) => msg.id === revertMessageID);
    if (revertIndex !== -1) {
      return messages.slice(revertIndex + 1);
    }
  }

  return messages;
}

export async function loadLatestAssistantResponse(
  sessionId: string,
  directory: string,
): Promise<string | null> {
  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: sessionId,
      directory,
      limit: LATEST_ASSISTANT_RESPONSE_MESSAGES_LIMIT,
    });

    if (error || !messages) {
      logger.warn("[Messages] Failed to fetch latest assistant response:", error);
      return null;
    }

    const latestResponse = (messages as SessionMessageLike[]).reduce<{
      text: string;
      created: number;
    } | null>((latest, message) => {
      if (message.info.role !== "assistant" || message.info.summary) {
        return latest;
      }

      const text = extractTextParts(message.parts);
      if (!text) {
        return latest;
      }

      const created = message.info.time?.created ?? 0;
      if (!latest || created >= latest.created) {
        return { text, created };
      }

      return latest;
    }, null);

    return latestResponse?.text ?? null;
  } catch (err) {
    logger.error("[Messages] Error loading latest assistant response:", err);
    return null;
  }
}
