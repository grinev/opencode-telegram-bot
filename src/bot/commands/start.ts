import { Context } from "grammy";
import { createDmKeyboard, createMainKeyboard } from "../utils/keyboard.js";
import { getStoredAgent } from "../../agent/manager.js";
import { getStoredModel } from "../../model/manager.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { t } from "../../i18n/index.js";
import { SCOPE_CONTEXT, getScopeFromContext } from "../scope.js";

export async function startCommand(ctx: Context): Promise<void> {
  const scope = getScopeFromContext(ctx);
  const scopeKey = scope?.key ?? "global";
  const usePinned = ctx.chat?.type !== "private";
  const isPrivateChat = ctx.chat?.type === "private";

  if (isPrivateChat) {
    await ctx.reply(`${t("start.welcome")}\n\n${t("start.welcome_dm")}`, {
      reply_markup: createDmKeyboard(),
    });
    return;
  }

  if (ctx.chat) {
    if (usePinned && !pinnedMessageManager.isInitialized(scopeKey)) {
      pinnedMessageManager.initialize(ctx.api, ctx.chat.id, scopeKey, scope?.threadId ?? null);
    }
    keyboardManager.initialize(ctx.api, ctx.chat.id, scopeKey);
  }

  if (usePinned && pinnedMessageManager.getContextLimit(scopeKey) === 0) {
    await pinnedMessageManager.refreshContextLimit(scopeKey);
  }

  // Get current agent, model, and context
  const currentAgent = getStoredAgent(scopeKey);
  const currentModel = getStoredModel(scopeKey);
  const variantName = formatVariantForButton(currentModel.variant || "default");
  const contextInfo =
    keyboardManager.getContextInfo(scopeKey) ??
    (usePinned ? pinnedMessageManager.getContextInfo(scopeKey) : null) ??
    (usePinned && pinnedMessageManager.getContextLimit(scopeKey) > 0
      ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit(scopeKey) }
      : null);

  keyboardManager.updateAgent(currentAgent, scopeKey);
  keyboardManager.updateModel(currentModel, scopeKey);
  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit, scopeKey);
  }

  const keyboard = createMainKeyboard(
    currentAgent,
    currentModel,
    contextInfo ?? undefined,
    variantName,
    scope?.context === SCOPE_CONTEXT.GROUP_GENERAL
      ? {
          contextFirst: true,
          contextLabel: t("keyboard.general_defaults"),
        }
      : undefined,
  );

  await ctx.reply(t("start.welcome"), { reply_markup: keyboard });
}
