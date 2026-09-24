import { Context, InlineKeyboard } from "grammy";
import { getCurrentSession } from "../../app/services/session-service.js";
import { loadLatestAssistantMetrics, type AssistantMessageMetrics } from "../../app/services/message-history-service.js";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { formatTokenCount } from "../pinned/pinned-message-format.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

function formatContextDetails(
  window: { tokensUsed: number; tokensLimit: number } | null,
  metrics: AssistantMessageMetrics | null,
): string {
  const used = window?.tokensUsed ?? 0;
  const limit = window?.tokensLimit ?? 0;
  const lines = [
    t("context.details.title"),
    t("context.details.window", {
      used: formatTokenCount(used),
      limit: limit > 0 ? formatTokenCount(limit) : t("pinned.unknown"),
      percent: limit > 0 ? Math.round((used / limit) * 100) : 0,
    }),
  ];

  if (metrics) {
    lines.push(
      "",
      t("context.details.token_breakdown"),
      t("context.details.input", { count: metrics.input }),
      t("context.details.output", { count: metrics.output }),
      t("context.details.reasoning", { count: metrics.reasoning }),
      t("context.details.cache_read", { count: metrics.cacheRead }),
      t("context.details.cache_write", { count: metrics.cacheWrite }),
      t("context.details.cost", { cost: `$${metrics.cost.toFixed(2)}` }),
    );
  }

  return lines.join("\n");
}

/**
 * Build inline keyboard with compact confirmation menu
 * @returns InlineKeyboard with confirmation button
 */
export function buildCompactConfirmationMenu(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text(t("context.button.confirm"), "compact:confirm");

  return keyboard;
}

/**
 * Handle context button press (text message from Reply Keyboard)
 * Shows context details with an inline compact action
 * @param ctx grammY context
 */
export async function handleContextButtonPress(
  ctx: Context,
  deps: Pick<AppContainer, "interactionManager" | "pinnedMessageManager">,
): Promise<void> {
  logger.debug("[ContextHandler] Context button pressed");

  const session = getCurrentSession();

  if (!session) {
    await ctx.reply(t("context.no_active_session"));
    return;
  }

  const metrics = await loadLatestAssistantMetrics(session.id, session.directory);
  const keyboard = new InlineKeyboard().text(t("context.button.details_compact"), "compact:details");

  await replyWithInlineMenu(ctx, {
    menuKind: "context",
    text: formatContextDetails(deps.pinnedMessageManager.getContextInfo(), metrics),
    keyboard,
    cancelButtonText: t("context.button.close"),
    metadata: { stage: "details" },
  }, deps);
}
