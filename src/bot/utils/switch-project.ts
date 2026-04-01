import type { Context } from "grammy";
import type { ProjectInfo } from "../../settings/manager.js";
import { setCurrentProject } from "../../settings/manager.js";
import { clearSession } from "../../session/manager.js";
import { summaryAggregator } from "../../summary/aggregator.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { getStoredAgent, resolveProjectAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { createMainKeyboard } from "./keyboard.js";
import { logger } from "../../utils/logger.js";

/**
 * Shared logic for switching the active project.
 *
 * Called by both `/projects` (selecting an existing project) and `/open`
 * (browsing and adding a new directory). Performs the full state transition:
 * persists the project, clears the session, resets the pinned message and
 * keyboard, and returns a fresh reply keyboard for the caller to attach to
 * its confirmation message.
 *
 * @param ctx       grammY callback context (used for `ctx.chat` / `ctx.api`)
 * @param project   the project to switch to
 * @param reason    short tag for `clearAllInteractionState` (e.g. "project_switched")
 */
export async function switchToProject(ctx: Context, project: ProjectInfo, reason: string) {
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

  return createMainKeyboard(currentAgent, currentModel, contextInfo, variantName);
}
