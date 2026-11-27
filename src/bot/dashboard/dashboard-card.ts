import { InlineKeyboard, type Api, type Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { formatDashboardGoalLine } from "../../app/formatters/goal-text.js";
import type { DashboardCardManager } from "../../app/managers/dashboard-card-manager.js";
import { getGitWorktreeContext } from "../../app/services/worktree-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { getDashboardButtonLabel, getDashboardSelection } from "../keyboards/dashboard-button.js";
import { DASHBOARD_CLOSE_CALLBACK } from "../message-patterns.js";
import { sendMessageWithMarkdownFallback } from "../messages/send-with-markdown-fallback.js";
import { getExpectedInputBlockReason } from "../middleware/interaction-guard-decision.js";
import { getInteractionBlockedMessage } from "../middleware/interaction-guard.js";
import { renderDashboard } from "../render/dashboard.js";

type DashboardDeps = Pick<
  AppContainer,
  "dashboardCardManager" | "goalManager" | "interactionManager" | "keyboardManager" | "sessionMetricsManager"
>;

async function deleteCard(api: Api, { chatId, messageId }: { chatId: number; messageId: number }) {
  try {
    await api.deleteMessage(chatId, messageId);
  } catch (error) {
    logger.debug(`[Dashboard] Could not delete card ${chatId}/${messageId}:`, error);
  }
}

export function retireDashboardCard(api: Api, manager: DashboardCardManager): void {
  const previous = manager.reset();
  if (previous) void deleteCard(api, previous);
}

function getOpenRefusal(interactionManager: DashboardDeps["interactionManager"]): string | null {
  const interaction = interactionManager.getSnapshot();
  return interaction
    ? getInteractionBlockedMessage(getExpectedInputBlockReason(interaction.expectedInput), interaction.kind)
    : null;
}

export async function handleDashboardOpen(ctx: Context, deps: DashboardDeps): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const { dashboardCardManager, interactionManager, keyboardManager, sessionMetricsManager } = deps;
  const generation = dashboardCardManager.beginOpen();
  const { project, session } = getDashboardSelection();
  try {
    if (ctx.message?.text !== getDashboardButtonLabel()) {
      keyboardManager.initialize(ctx.api, chatId);
      await keyboardManager.sendKeyboardUpdate(chatId);
    }
    if (!dashboardCardManager.isCurrent(generation)) return;

    const [metrics, git] = await Promise.all([
      session ? sessionMetricsManager.snapshot(session) : null,
      project
        ? getGitWorktreeContext(project.worktree).catch((error: unknown) => {
            logger.debug(`[Dashboard] Could not load worktree for ${project.worktree}:`, error);
            return null;
          })
        : null,
    ]);
    if (!dashboardCardManager.isCurrent(generation)) return;
    const refusal = getOpenRefusal(interactionManager);
    if (refusal) {
      await ctx.reply(refusal);
      return;
    }
    const goal = deps.goalManager.snapshot();
    const currentSession = getDashboardSelection().session;
    const text = renderDashboard({
      project,
      session: session && session.id === currentSession?.id ? currentSession : session,
      git,
      goal: session && goal.sessionId === session.id ? formatDashboardGoalLine(goal.goal) : null,
      metrics,
    });
    const message = await sendMessageWithMarkdownFallback({
      api: ctx.api,
      chatId,
      text,
      options: {
        reply_markup: new InlineKeyboard().text(t("dashboard.button.close"), DASHBOARD_CLOSE_CALLBACK),
        link_preview_options: { is_disabled: true },
      },
    });
    const card = { chatId, messageId: message.message_id };
    if (!dashboardCardManager.isCurrent(generation)) {
      void deleteCard(ctx.api, card);
      return;
    }
    const lateRefusal = getOpenRefusal(interactionManager);
    if (lateRefusal) {
      void deleteCard(ctx.api, card);
      await ctx.reply(lateRefusal);
      return;
    }
    const previous = dashboardCardManager.replace(card);
    if (previous) void deleteCard(ctx.api, previous);
  } catch (error) {
    logger.warn(`[Dashboard] Could not open card in ${chatId}:`, error);
    if (dashboardCardManager.isCurrent(generation)) {
      await ctx.reply(t("error.generic")).catch(() => {});
    }
  }
}

export async function handleDashboardClose(ctx: Context, manager: DashboardCardManager): Promise<boolean> {
  if (ctx.callbackQuery?.data !== DASHBOARD_CLOSE_CALLBACK) return false;
  const message = ctx.callbackQuery.message;
  if (!message || !manager.close(message.chat.id, message.message_id)) {
    await ctx.answerCallbackQuery({ text: t("inline.inactive_callback") });
  } else {
    void deleteCard(ctx.api, { chatId: message.chat.id, messageId: message.message_id });
    await ctx.answerCallbackQuery();
  }
  return true;
}
