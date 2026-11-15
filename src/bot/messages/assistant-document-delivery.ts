import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { InputFile, type Api, type RawApi } from "grammy";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import {
  classifyAssistantDocuments,
  isDocumentSizeError,
  readAssistantDocument,
  type AssistantDocumentKind,
} from "../../app/services/assistant-document-service.js";
import { telegramOutageNoticeService } from "../../app/services/telegram-outage-notice-service.js";
import {
  collectAssistantFileLinks,
  projectAssistantFileLabels,
  type AssistantFileLink,
} from "../render/assistant-file-links.js";
import { sendBotText } from "./telegram-text.js";

export interface PreparedAssistantDocuments {
  text: string;
  documents: Array<AssistantFileLink & { kind: AssistantDocumentKind }>;
  directory: string | undefined;
  canDeliver: () => boolean;
}

export async function prepareAssistantDocuments(
  text: string,
  directory?: string,
  canDeliver: () => boolean = () => true,
  source = text,
): Promise<PreparedAssistantDocuments> {
  const prepared: PreparedAssistantDocuments = { text, documents: [], directory, canDeliver };
  if (config.bot.messageFormatMode !== "markdown" || !canDeliver()) return prepared;
  const links = collectAssistantFileLinks(source);
  const textLinks = source === text ? links : collectAssistantFileLinks(text, source);
  const kinds = await classifyAssistantDocuments(directory, [
    ...new Set(links.map((link) => link.path)),
  ]);
  const qualifies = (link: AssistantFileLink): boolean => kinds.get(link.path) !== "directory";
  prepared.text = projectAssistantFileLabels(text, textLinks.filter(qualifies));
  prepared.documents = links.filter(qualifies).map((link) => ({
    ...link,
    kind: kinds.get(link.path) ?? "unknown",
  }));
  return prepared;
}

async function waitForDocumentSlot(): Promise<void> {
  let wait: number;
  while ((wait = telegramOutageNoticeService.msUntilAllowedSend()) > 0) await delay(wait);
}

export async function deliverAssistantDocuments(
  prepared: PreparedAssistantDocuments,
  api: Pick<Api<RawApi>, "sendDocument" | "sendMessage">,
  chatId: number,
  options?: { disable_notification?: boolean },
): Promise<void> {
  for (const document of prepared.documents) {
    if (!prepared.canDeliver()) return;
    const filename = path.posix.basename(document.path);
    const name = (document.name || filename).slice(0, 1024);
    let reason: "unavailable" | "too_large" | undefined;
    const result = await readAssistantDocument(prepared.directory, document.path, document.kind);
    if (!prepared.canDeliver()) return;
    if ("reason" in result) reason = result.reason;
    else {
      await waitForDocumentSlot();
      if (!prepared.canDeliver()) return;
      try {
        await api.sendDocument(chatId, new InputFile(result.bytes, filename), {
          ...options,
          caption: name,
        });
      } catch (error) {
        reason = isDocumentSizeError(error) ? "too_large" : "unavailable";
        logger.debug("[AssistantDocument] Upload failed", { file: document.path, error });
      }
    }
    if (!reason || !prepared.canDeliver()) continue;
    await waitForDocumentSlot();
    if (!prepared.canDeliver()) return;
    try {
      await sendBotText({
        api,
        chatId,
        text: t(`assistant.file.${reason}`, {
          name,
          maxSizeMb: config.files.outgoingDocumentMaxSizeMb,
        }),
        options: { ...options, link_preview_options: { is_disabled: true } },
        format: "raw",
      });
    } catch (error) {
      // An unavailable notice is best-effort; never replay an accepted reply/upload.
      logger.debug("[AssistantDocument] Notice failed", { file: document.path, error });
    }
  }
}
