import type { Api } from "grammy";
import { chunkPlainText } from "../render/chunker.js";

/** Sends a goal reply through the existing plain-text chunker. */
export async function sendGoalText(api: Api, chatId: number, text: string): Promise<void> {
  const chunks = chunkPlainText(text);
  for (const chunk of chunks) {
    await api.sendMessage(chatId, chunk.fallbackText, { link_preview_options: { is_disabled: true } });
  }
}
