import { InputFile } from "grammy";
import { config } from "../../config.js";

const MAX_CACHED_RESPONSES = 128;

export interface AssistantResponseExportApi {
  sendDocument: (chatId: number, document: InputFile) => Promise<unknown>;
}

interface CachedAssistantResponse {
  chatId: number;
  sessionId: string;
  text: string;
}

const cachedResponses = new Map<string, CachedAssistantResponse>();

function getCacheKey(chatId: number, sessionId: string): string {
  return `${chatId}:${sessionId}`;
}

function createResponseFilename(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");

  return `opencode-response-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.md`;
}

export function createAssistantResponseDocument(
  text: string,
  now: Date = new Date(),
): { filename: string; buffer: Buffer } {
  return {
    filename: createResponseFilename(now),
    buffer: Buffer.from(text, "utf8"),
  };
}

export function rememberAssistantResponse(chatId: number, sessionId: string, text: string): void {
  const key = getCacheKey(chatId, sessionId);
  cachedResponses.delete(key);
  cachedResponses.set(key, { chatId, sessionId, text });

  while (cachedResponses.size > MAX_CACHED_RESPONSES) {
    const oldestKey = cachedResponses.keys().next().value;
    if (!oldestKey) {
      break;
    }

    cachedResponses.delete(oldestKey);
  }
}

export function getRememberedAssistantResponse(chatId: number, sessionId: string): string | null {
  return cachedResponses.get(getCacheKey(chatId, sessionId))?.text ?? null;
}

export async function sendAssistantResponseDocument(
  api: AssistantResponseExportApi,
  chatId: number,
  text: string,
): Promise<void> {
  const { filename, buffer } = createAssistantResponseDocument(text);
  await api.sendDocument(chatId, new InputFile(buffer, filename));
}

export function shouldAutomaticallyExportAssistantResponse(text: string): boolean {
  return text.length > config.bot.assistantResponseFileThreshold;
}

export function __resetAssistantResponseExportsForTests(): void {
  cachedResponses.clear();
}
