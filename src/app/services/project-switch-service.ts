import type { Context } from "grammy";
import type { ProjectInfo } from "../types/project.js";
import { setCurrentProject } from "../stores/settings-store.js";
import { clearSession } from "./session-service.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { pinnedMessageManager } from "../../bot/pinned/pinned-message-manager.js";
import { keyboardManager } from "../../bot/keyboards/keyboard-manager.js";
import { detachAttachedSession } from "./attach-service.js";
import { stopEventListening } from "../../opencode/events.js";
import { backgroundSessionTracker } from "../managers/background-session-manager.js";
import { getStoredAgent, resolveProjectAgent } from "./agent-selection-service.js";
import { getStoredModel } from "./model-selection-service.js";
import { formatVariantForButton } from "./variant-selection-service.js";
import { clearAllInteractionState } from "../managers/interaction-manager.js";
import { createMainKeyboard } from "../../bot/keyboards/main-reply-keyboard.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config.js";

interface SwitchToProjectOptions {
  ensureEventSubscription?: (directory: string) => Promise<void>;
}

export async function switchToProject(
  ctx: Context,
  project: ProjectInfo,
  reason: string,
  options: SwitchToProjectOptions = {},
) {
  detachAttachedSession(reason);
  stopEventListening();
  backgroundSessionTracker.clear();
  setCurrentProject(project);
  clearSession();
  summaryAggregator.clear();
  clearAllInteractionState(reason);

  try {
    await pinnedMessageManager.clear();
  } catch (err) {
    logger.error("[Bot] Error clearing pinned message:", err);
  }

  if (ctx.chat) {
    keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  await pinnedMessageManager.refreshContextLimit();
  const contextLimit = pinnedMessageManager.getContextLimit();
  keyboardManager.updateContext(0, contextLimit);

  const currentAgent = await resolveProjectAgent(getStoredAgent());
  const currentModel = getStoredModel();
  const contextInfo = { tokensUsed: 0, tokensLimit: contextLimit };
  const variantName = formatVariantForButton(currentModel.variant || "default");
  keyboardManager.updateAgent(currentAgent);

  if (config.bot.trackBackgroundSessions && options.ensureEventSubscription) {
    await options.ensureEventSubscription(project.worktree);
  }

  return createMainKeyboard(currentAgent, currentModel, contextInfo, variantName);
}
