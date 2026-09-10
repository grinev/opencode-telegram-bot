import { promptQueue, type QueuedPrompt } from "../../app/managers/prompt-queue-manager.js";
import { t } from "../../i18n/index.js";

const QUEUED_PROMPT_PREVIEW_MAX_LENGTH = 28;

function buildPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= QUEUED_PROMPT_PREVIEW_MAX_LENGTH) {
    return collapsed;
  }

  return `${collapsed.slice(0, QUEUED_PROMPT_PREVIEW_MAX_LENGTH - 1)}…`;
}

/**
 * Build the reply-keyboard label for a queued prompt.
 * The 1-based index keeps labels unique even when two queued prompts share the
 * same text, which is what makes press-to-remove resolvable by label alone.
 */
export function formatQueuedPromptButtonLabel(index: number, text: string): string {
  return t("keyboard.queued_prompt", { index: String(index), text: buildPreview(text) });
}

export function getQueuedPromptButtonLabels(): string[] {
  return promptQueue
    .list()
    .map((item, index) => formatQueuedPromptButtonLabel(index + 1, item.displayText));
}

export function findQueuedPromptByButtonLabel(label: string): QueuedPrompt | null {
  const items = promptQueue.list();
  const index = items.findIndex(
    (item, itemIndex) => formatQueuedPromptButtonLabel(itemIndex + 1, item.displayText) === label,
  );

  return index < 0 ? null : (items[index] ?? null);
}
