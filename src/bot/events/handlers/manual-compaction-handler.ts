import { config } from "../../../config.js";
import { t } from "../../../i18n/index.js";
import type { InteractionManager } from "../../../app/managers/interaction-manager.js";
import type { ManualCompactionService } from "../../../app/services/manual-compaction-service.js";
import type { CompactionOutcome } from "../../../opencode/manual-compaction.js";
import { createBackgroundNoticeDelivery } from "../background-notice-delivery.js";
import type { SessionTargetPolicy, TelegramEventDelivery } from "../telegram-event-delivery.js";

export function compactionResultText(outcome: CompactionOutcome): string {
  switch (outcome) {
    case "success":
      return t("context.success");
    case "failure":
      return t("context.error");
    case "interrupted":
      return t("context.interrupted");
    case "unknown":
      return t("context.outcome_unknown");
  }
}

export function registerManualCompactionPresentation(
  manualCompaction: ManualCompactionService,
  interactionManager: InteractionManager,
  policy: SessionTargetPolicy,
  delivery: TelegramEventDelivery,
): void {
  const notify = createBackgroundNoticeDelivery(policy, delivery);
  manualCompaction.configurePresentation({
    isSelected: policy.isForegroundSession,
    releaseInteractions: () => interactionManager.releaseNext(),
    openProgress: async (session) => {
      const destination = policy.getDestination(session.id);
      if (!destination || !policy.isForegroundSession(session.id)) return undefined;
      const messageId = await delivery.sendText(destination, t("context.progress"));
      return {
        finish: (outcome) =>
          delivery.editText(destination, messageId, compactionResultText(outcome)),
      };
    },
    notifySuccess: async (session) => {
      if (!config.bot.trackBackgroundSessions) return;
      await notify({
        kind: "context_compacted",
        sessionId: session.id,
        sessionDirectory: session.directory,
        sessionTitle: session.title,
      });
    },
  });
}
