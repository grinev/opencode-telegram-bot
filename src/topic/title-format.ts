import { TOPIC_NAME_MAX_LENGTH, TOPIC_NAME_TRUNCATION_SUFFIX } from "./title-constants.js";

const TOPIC_TITLE_FALLBACK = "Session";

export function formatTopicTitle(rawTitle: string, fallbackTitle?: string): string {
  const baseTitle = rawTitle.trim() || fallbackTitle?.trim() || TOPIC_TITLE_FALLBACK;

  if (baseTitle.length <= TOPIC_NAME_MAX_LENGTH) {
    return baseTitle;
  }

  const allowedLength = TOPIC_NAME_MAX_LENGTH - TOPIC_NAME_TRUNCATION_SUFFIX.length;
  return `${baseTitle.slice(0, allowedLength).trimEnd()}${TOPIC_NAME_TRUNCATION_SUFFIX}`;
}
