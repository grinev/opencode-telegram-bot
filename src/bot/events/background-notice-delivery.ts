import { t } from "../../i18n/index.js";
import type { BackgroundSessionNotification } from "../../app/managers/background-session-manager.js";
import { buildBackgroundSessionOpenKeyboard } from "../menus/session-selection-menu.js";
import type { SessionTargetPolicy, TelegramEventDelivery } from "./telegram-event-delivery.js";

function formatShortSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}

function getBackgroundSessionLabel(notification: BackgroundSessionNotification): string {
  const title = notification.sessionTitle?.trim();
  if (title) {
    return title;
  }

  return t("background.session_fallback", {
    id: formatShortSessionId(notification.sessionId),
  });
}

function formatBackgroundSessionNotification(notification: BackgroundSessionNotification): string {
  const session = getBackgroundSessionLabel(notification);

  switch (notification.kind) {
    case "assistant_response":
      return t("background.assistant_response", { session });
    case "question_asked":
      return t("background.question_asked", { session });
    case "permission_asked":
      return t("background.permission_asked", { session });
  }
}

/** Sends a background-session notice to the destination of its own session. */
export function createBackgroundNoticeDelivery(
  policy: Pick<SessionTargetPolicy, "getDestination">,
  delivery: TelegramEventDelivery,
): (notification: BackgroundSessionNotification) => Promise<void> {
  return async (notification) => {
    const destination = policy.getDestination(notification.sessionId);
    if (!destination) {
      return;
    }

    await delivery.sendText(destination, formatBackgroundSessionNotification(notification), {
      reply_markup: buildBackgroundSessionOpenKeyboard(notification.sessionId, notification.kind),
    });
  };
}
