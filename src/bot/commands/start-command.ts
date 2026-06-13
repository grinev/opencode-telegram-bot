import { Context } from "grammy";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { getStoredAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { formatVariantForButton } from "../../app/services/variant-selection-service.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { clearSession } from "../../app/services/session-service.js";
import { clearProject } from "../../app/stores/settings-store.js";
import { foregroundSessionState } from "../../app/managers/foreground-session-state-manager.js";
import { abortCurrentOperation } from "./abort-command.js";
import { t } from "../../i18n/index.js";
import { assistantRunState } from "../../app/managers/assistant-run-state-manager.js";
import { detachAttachedSession } from "../../app/services/attach-service.js";

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
