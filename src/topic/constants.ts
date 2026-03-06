import { TOPIC_SESSION_STATUS } from "../settings/manager.js";
import type { TopicSessionStatus } from "../settings/manager.js";

export const TOPIC_CLEANUP_POLICY = {
  CLOSE_ONLY: "close-only",
} as const;

export const TOPIC_STATUS_CLOSEABLE = new Set<TopicSessionStatus>([
  TOPIC_SESSION_STATUS.CLOSED,
  TOPIC_SESSION_STATUS.STALE,
  TOPIC_SESSION_STATUS.ABANDONED,
  TOPIC_SESSION_STATUS.ERROR,
]);
