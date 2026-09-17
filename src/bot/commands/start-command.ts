import { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { getStoredAgent } from "../../app/services/agent-selection-service.js";
import { getStoredModel } from "../../app/services/model-selection-service.js";
import { formatVariantForButton } from "../../app/services/variant-selection-service.js";
import { clearSession } from "../../app/services/session-service.js";
import { clearProject } from "../../app/stores/settings-store.js";
import { abortCurrentOperation, type AbortCommandDeps } from "./abort-command.js";
import { t } from "../../i18n/index.js";
import { detachAttachedSession } from "../../app/services/attach-service.js";

export type StartCommandDeps = AbortCommandDeps &
  Pick<AppContainer, "keyboardManager" | "pinnedMessageManager" | "resetAggregator">;

export async function startCommand(ctx: Context, deps: StartCommandDeps): Promise<void> {
  if (ctx.chat) {
    if (!deps.pinnedMessageManager.isInitialized()) {
      deps.pinnedMessageManager.initialize(ctx.api, ctx.chat.id);
    }
    deps.keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  await abortCurrentOperation(ctx, deps, { notifyUser: false });
  detachAttachedSession("start_command_reset", deps);
  deps.foregroundSessionState.clearAll("start_command_reset");
  deps.assistantRunState.clearAll("start_command_reset");

  clearSession();
  clearProject();
  deps.keyboardManager.clearContext();
  await deps.pinnedMessageManager.clear();

  if (deps.pinnedMessageManager.getContextLimit() === 0) {
    await deps.pinnedMessageManager.refreshContextLimit();
  }

  // Get current agent, model, and context
  const currentAgent = getStoredAgent();
  const currentModel = getStoredModel();
  const variantName = formatVariantForButton(currentModel.variant || "default");
  const contextInfo =
    deps.pinnedMessageManager.getContextInfo() ??
    (deps.pinnedMessageManager.getContextLimit() > 0
      ? { tokensUsed: 0, tokensLimit: deps.pinnedMessageManager.getContextLimit() }
      : null);

  deps.keyboardManager.updateAgent(currentAgent);
  deps.keyboardManager.updateModel(currentModel);
  if (contextInfo) {
    deps.keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }

  const keyboard = createMainKeyboard(
    currentAgent,
    currentModel,
    contextInfo ?? undefined,
    variantName,
  );

  await ctx.reply(t("start.welcome"), { reply_markup: keyboard });
}
