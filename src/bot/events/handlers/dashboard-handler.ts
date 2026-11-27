import { isCompactProgressMode, type EventHandlerDeps } from "./handler-context.js";

type DashboardDeps = EventHandlerDeps<
  "keyboardManager" | "sessionMetricsManager" | "summaryAggregator"
>;

/** Live values for the keyboard and on-demand snapshots, not Telegram card edits. */
export function registerDashboardHandlers(
  deps: DashboardDeps,
  reconcileTitle?: (sessionId: string) => void,
): void {
  const { runtime, keyboardManager, sessionMetricsManager, summaryAggregator, policy } = deps;

  summaryAggregator.setOnTokens((sessionId, tokens, isCompleted) => {
    if (!policy.isForegroundSession(sessionId)) return;
    const contextSize = tokens.input + tokens.cacheRead;
    if (isCompleted || contextSize > 0) sessionMetricsManager.onTokens(sessionId, contextSize);
    if (isCompleted) reconcileTitle?.(sessionId);
  });

  summaryAggregator.setOnCost((sessionId, cost) => {
    if (policy.isForegroundSession(sessionId)) {
      sessionMetricsManager.onCostUpdate(sessionId, cost);
    }
  });

  summaryAggregator.setOnSessionCompacted(async (sessionId, directory) => {
    if (policy.isForegroundSession(sessionId)) {
      await sessionMetricsManager.onSessionCompacted(sessionId, directory);
    }
  });

  summaryAggregator.setOnSessionDiff((sessionId, diffs) => {
    if (isCompactProgressMode()) {
      // Held with the card's other updates, so it keeps their order.
      void summaryAggregator.runOutbound(() => {
        for (const diff of diffs) {
          runtime.compactProgressStreamer.addFileChange(sessionId, diff.file);
        }
      });
    }

    if (policy.isForegroundSession(sessionId)) {
      sessionMetricsManager.onSessionDiff(sessionId, diffs);
    }
  });

  summaryAggregator.setOnFileChange((sessionId, change) => {
    if (isCompactProgressMode()) {
      void summaryAggregator.runOutbound(() =>
        runtime.compactProgressStreamer.addFileChange(sessionId, change.file),
      );
    }
  });

  sessionMetricsManager.setOnKeyboardUpdate((tokensUsed, tokensLimit) => {
    if (keyboardManager.isInitialized()) {
      keyboardManager.updateContext(tokensUsed, tokensLimit);
    }
  });
}
