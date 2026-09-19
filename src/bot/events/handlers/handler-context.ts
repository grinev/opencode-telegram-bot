import type { AppContainer } from "../../../app/bootstrap/app-container.js";
import { getCompactOutputMode } from "../../../app/stores/settings-store.js";
import { t } from "../../../i18n/index.js";
import type { SessionRuntimeState } from "../session-runtime-state.js";
import type { SessionTargetPolicy } from "../telegram-event-delivery.js";

/** What every event handler family is given explicitly. */
export interface EventHandlerBase {
  runtime: SessionRuntimeState;
  policy: SessionTargetPolicy;
}

export type EventHandlerDeps<K extends keyof AppContainer> = EventHandlerBase &
  Pick<AppContainer, K>;

export const SUBAGENT_STREAM_PREFIX = "🧩";

const SESSION_MESSAGE_MAX_LENGTH = 3500;

export function isCompactProgressMode(): boolean {
  return getCompactOutputMode();
}

export function getReplyKeyboard(deps: Pick<AppContainer, "keyboardManager">) {
  if (!deps.keyboardManager.isInitialized()) {
    return undefined;
  }

  return deps.keyboardManager.getKeyboard();
}

/** An error or retry text from OpenCode, trimmed to fit one Telegram message. */
export function formatSessionMessage(message: string): string {
  const normalizedMessage = message.trim() || t("common.unknown_error");
  return normalizedMessage.length > SESSION_MESSAGE_MAX_LENGTH
    ? `${normalizedMessage.slice(0, SESSION_MESSAGE_MAX_LENGTH - 3)}...`
    : normalizedMessage;
}
