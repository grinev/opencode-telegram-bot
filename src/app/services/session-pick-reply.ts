import { t } from "../../i18n/index.js";
import { truncateExternalUserInputText } from "./external-user-input-service.js";
import { buildQuotedNotification, type QuotedNotification } from "./quoted-notification.js";

export interface SessionPickPart {
  type: string;
  text?: string;
  filename?: string;
}

export interface SessionPickMessage {
  info: {
    id?: string;
    role?: string;
    summary?: boolean;
    parentID?: string;
    error?: unknown;
    time?: {
      created?: number;
      completed?: number;
    };
  };
  parts: SessionPickPart[];
}

export interface EligibleReply {
  text: string;
  parentId: string | null;
  created: number;
}

function extractText(parts: SessionPickPart[]): string | null {
  const text = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
  return text.trim().length > 0 ? text : null;
}

function fileLines(parts: SessionPickPart[]): string[] {
  return parts
    .filter((part) => part.type === "file")
    .map((part) => {
      const name = part.filename?.trim();
      return `📎 ${name ? name : t("sessions.last_input.attachment")}`;
    });
}

export function findEligibleReply(
  messages: SessionPickMessage[],
  busy: boolean,
): EligibleReply | null {
  let latest: EligibleReply | null = null;

  for (const message of messages) {
    if (message.info.role !== "assistant" || message.info.summary) {
      continue;
    }
    if (message.info.error) {
      continue;
    }
    if (busy && message.info.time?.completed === undefined) {
      continue;
    }

    const text = extractText(message.parts);
    if (!text) {
      continue;
    }

    const created = message.info.time?.created ?? 0;
    if (!latest || created >= latest.created) {
      latest = {
        text,
        parentId: message.info.parentID ?? null,
        created,
      };
    }
  }

  return latest;
}

export function findLatestUserPrompt(messages: SessionPickMessage[]): SessionPickMessage | null {
  let latest: SessionPickMessage | null = null;
  let latestCreated = -1;

  for (const message of messages) {
    if (message.info.role !== "user") {
      continue;
    }
    if (!extractText(message.parts) && fileLines(message.parts).length === 0) {
      continue;
    }

    const created = message.info.time?.created ?? 0;
    if (!latest || created >= latestCreated) {
      latest = message;
      latestCreated = created;
    }
  }

  return latest;
}

export function findMessageById(
  messages: SessionPickMessage[],
  messageId: string,
): SessionPickMessage | null {
  return messages.find((message) => message.info.id === messageId) ?? null;
}

export function buildSessionPickQuote(message: SessionPickMessage): QuotedNotification | null {
  const text = extractText(message.parts);
  const body = text ?? fileLines(message.parts).join("\n");
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  return buildQuotedNotification(
    `👤 ${t("sessions.last_input.title")}`,
    truncateExternalUserInputText(normalized),
  );
}
