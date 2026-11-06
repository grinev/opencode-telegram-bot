import { formatGoalNotice } from "../../../app/formatters/goal-text.js";
import { logger } from "../../../utils/logger.js";
import { sendGoalText } from "../../messages/goal-delivery.js";
import type { EventHandlerDeps } from "./handler-context.js";

type GoalHandlerDeps = EventHandlerDeps<"goalService" | "pinnedMessageManager" | "keyboardManager">;

/** Sends a pause or completion the goal service has already decided is due. */
export function registerGoalHandlers(deps: GoalHandlerDeps): void {
  const { policy, goalService, pinnedMessageManager } = deps;

  goalService.setOnSnapshot(() => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }
    return pinnedMessageManager.refresh();
  });

  goalService.setOnNotice(async (sessionId, notice) => {
    const destination = policy.getDestination(sessionId);
    if (!destination || !policy.isForegroundSession(sessionId)) {
      return;
    }

    try {
      await sendGoalText(destination.api, destination.chatId, formatGoalNotice(notice), deps.keyboardManager.getKeyboard());
    } catch (error) {
      logger.warn("[Goal] Failed to send a goal notice", error);
    }
  });
}
