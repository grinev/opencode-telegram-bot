import type { AssistantRunInfo } from "../../../app/managers/assistant-run-state-manager.js";
import { formatAssistantRunFooter } from "../../../app/formatters/assistant-run-footer-formatter.js";
import {
  getDeleteCompactProgressOnFinish,
  getShowAssistantRunFooter,
} from "../../../app/stores/settings-store.js";
import type { TelegramDestination } from "../telegram-event-delivery.js";
import { getReplyKeyboard, type EventHandlerDeps } from "./handler-context.js";

type RunCloseDeps = EventHandlerDeps<"keyboardManager">;

/**
 * Closes a foreground run in the chat: flushes its tool output, finalizes the compact
 * progress card and sends the run footer when the run produced a response.
 */
export async function closeForegroundRun(
  deps: RunCloseDeps,
  sessionId: string,
  destination: TelegramDestination,
  completedRun: AssistantRunInfo | null,
  reason: string,
): Promise<void> {
  const { runtime } = deps;
  await Promise.all([
    runtime.toolMessageBatcher.flushSession(sessionId, reason),
    runtime.toolCallStreamer.breakSession(sessionId, reason),
  ]);

  await runtime.compactProgressStreamer.finalize(sessionId, getDeleteCompactProgressOnFinish());

  if (!getShowAssistantRunFooter() || !completedRun?.hasCompletedResponse) {
    return;
  }

  const agent = completedRun.actualAgent || completedRun.configuredAgent;
  const providerID = completedRun.actualProviderID || completedRun.configuredProviderID;
  const modelID = completedRun.actualModelID || completedRun.configuredModelID;
  if (!agent || !providerID || !modelID) {
    return;
  }

  const keyboard = getReplyKeyboard(deps);
  await runtime.delivery.sendText(
    destination,
    formatAssistantRunFooter({
      agent,
      providerID,
      modelID,
      elapsedMs: Date.now() - completedRun.startedAt,
    }),
    {
      ...(keyboard ? { reply_markup: keyboard } : {}),
    },
  );
}
