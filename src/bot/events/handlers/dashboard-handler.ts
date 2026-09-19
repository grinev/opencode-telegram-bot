import { logger } from "../../../utils/logger.js";
import { isCompactProgressMode, type EventHandlerDeps } from "./handler-context.js";

type DashboardDeps = EventHandlerDeps<
  "keyboardManager" | "pinnedMessageManager" | "summaryAggregator"
>;

/** Token, cost, context and changed-file updates for the pinned dashboard and keyboard. */
export function registerDashboardHandlers(deps: DashboardDeps): void {
  const { runtime, keyboardManager, pinnedMessageManager, summaryAggregator } = deps;

  summaryAggregator.setOnTokens(async (_sessionId, tokens, isCompleted) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      logger.debug(
        `[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}, completed=${isCompleted}`,
      );

      const contextSize = tokens.input + tokens.cacheRead;
      const contextLimit = pinnedMessageManager.getContextLimit();

      if (!isCompleted && contextSize === 0) {
        logger.debug("[Bot] Skipping zero-token intermediate update");
        return;
      }

      if (contextLimit > 0) {
        keyboardManager.updateContext(contextSize, contextLimit);
      }
      pinnedMessageManager.updateTokensSilent(tokens);

      if (isCompleted) {
        await pinnedMessageManager.onMessageComplete(tokens);
      }
    } catch (err) {
      logger.error("[Bot] Error updating pinned message with tokens:", err);
    }
  });

  summaryAggregator.setOnCost(async (_sessionId, cost) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      logger.debug(`[Bot] Cost update: $${cost.toFixed(2)}`);
      await pinnedMessageManager.onCostUpdate(cost);
    } catch (err) {
      logger.error("[Bot] Error updating cost:", err);
    }
  });

  summaryAggregator.setOnSessionCompacted(async (sessionId, directory) => {
    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      logger.info(`[Bot] Session compacted, reloading context: ${sessionId}`);
      await pinnedMessageManager.onSessionCompacted(sessionId, directory);
    } catch (err) {
      logger.error("[Bot] Error reloading context after compaction:", err);
    }
  });

  summaryAggregator.setOnSessionDiff(async (sessionId, diffs) => {
    if (isCompactProgressMode()) {
      for (const diff of diffs) {
        runtime.compactProgressStreamer.addFileChange(sessionId, diff.file);
      }
    }

    if (!pinnedMessageManager.isInitialized()) {
      return;
    }

    try {
      await pinnedMessageManager.onSessionDiff(diffs);
    } catch (err) {
      logger.error("[Bot] Error updating session diff:", err);
    }
  });

  summaryAggregator.setOnFileChange((sessionId, change) => {
    if (isCompactProgressMode()) {
      runtime.compactProgressStreamer.addFileChange(sessionId, change.file);
    }

    if (!pinnedMessageManager.isInitialized()) {
      return;
    }
    pinnedMessageManager.addFileChange(change);
  });

  pinnedMessageManager.setOnKeyboardUpdate(async (tokensUsed, tokensLimit) => {
    try {
      logger.debug(`[Bot] Updating keyboard with context: ${tokensUsed}/${tokensLimit}`);
      keyboardManager.updateContext(tokensUsed, tokensLimit);
    } catch (err) {
      logger.error("[Bot] Error updating keyboard context:", err);
    }
  });
}
