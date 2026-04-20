import { Context } from "grammy";
import { createMainKeyboard } from "../utils/keyboard.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { clearSession } from "../../session/manager.js";
import { clearProject } from "../../settings/manager.js";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { abortCurrentOperation } from "./abort.js";
import { t } from "../../i18n/index.js";
import { assistantRunState } from "../assistant-run-state.js";
import { detachAttachedSession } from "../../attach/service.js";

export async function startCommand(ctx: Context): Promise<void> {
  if (ctx.chat) {
    if (!pinnedMessageManager.isInitialized()) {
      pinnedMessageManager.initialize(ctx.api, ctx.chat.id);
    }
    keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  await abortCurrentOperation(ctx, { notifyUser: false });
  detachAttachedSession("start_command_reset");
  foregroundSessionState.clearAll("start_command_reset");
  assistantRunState.clearAll("start_command_reset");

  clearSession();
  clearProject();
  keyboardManager.clearContext();
  await pinnedMessageManager.clear();

  if (pinnedMessageManager.getContextLimit() === 0) {
    await pinnedMessageManager.refreshContextLimit();
  }

  // Get current agent, model, and context
  const currentAgent = getStoredAgent();
  const currentModel = getStoredModel();
  const variantName = formatVariantForButton(currentModel.variant || "default");
  const contextInfo =
    pinnedMessageManager.getContextInfo() ??
    (pinnedMessageManager.getContextLimit() > 0
      ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
      : null);

  keyboardManager.updateAgent(currentAgent);
  keyboardManager.updateModel(currentModel);
  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }

  const keyboard = createMainKeyboard(
    currentAgent,
    currentModel,
    contextInfo ?? undefined,
    variantName,
  );

  await ctx.reply(t("start.welcome"), { reply_markup: keyboard });
}
