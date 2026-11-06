import type { Api, InlineKeyboard, Keyboard } from "grammy";
import { chunkPlainText } from "../render/chunker.js";

/** Sends a goal reply through the existing plain-text chunker. */
export async function sendGoalText(
  api: Api,
  chatId: number,
  text: string,
  replyMarkup?: Keyboard | InlineKeyboard,
): Promise<void> {
  const chunks = chunkPlainText(text);
  for (const [index, chunk] of chunks.entries()) {
    await api.sendMessage(chatId, chunk.fallbackText, {
      link_preview_options: { is_disabled: true },
      ...(replyMarkup && index === chunks.length - 1 ? { reply_markup: replyMarkup } : {}),
    });
  }
}
