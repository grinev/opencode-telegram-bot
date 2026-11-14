/**
 * Telegram rich messages allow 32768 characters and 500 blocks (nested blocks,
 * list items, table rows and details bodies all count). Plain text messages are
 * still capped at 4096 characters, so the two representations of the same
 * content are chunked with different budgets.
 */
export const DEFAULT_MAX_PART_CHARS = 32000;
export const DEFAULT_MAX_PART_BLOCKS = 480;
export const DEFAULT_MAX_PART_MEDIA = 50;

/** Budget for text that is delivered as a plain Telegram message. */
export const PLAIN_MAX_PART_CHARS = 3800;

/** Hard Telegram limit for `sendMessage` / `editMessageText` / `sendMessageDraft` text. */
export const TELEGRAM_TEXT_MESSAGE_LIMIT = 4096;
