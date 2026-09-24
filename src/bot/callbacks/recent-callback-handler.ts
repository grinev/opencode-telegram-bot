import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { switchToProject } from "../../app/services/project-switch-service.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { ensureActiveInlineMenu } from "../menus/inline-menu.js";
import { RECENT_CALLBACK_PREFIX } from "../menus/recent-selection-menu.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";
import { createProjectSwitchPresentation } from "../services/project-switch-presentation.js";
import { selectSessionById, type SessionSelectDeps } from "./session-callback-handler.js";
import { failure } from "./feedback.js";

type RecentSelectDeps = SessionSelectDeps & Pick<AppContainer,
  "backgroundSessionTracker" | "pinnedMessageManager" | "resetAggregator">;

export async function handleRecentSelect(ctx: Context, deps: RecentSelectDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith(RECENT_CALLBACK_PREFIX)) return false;
  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return true;
  }
  if (!await ensureActiveInlineMenu(ctx, "recent", deps)) return true;

  const indexText = data.slice(RECENT_CALLBACK_PREFIX.length);
  const metadata = deps.interactionManager.getSnapshot()?.metadata;
  const index = /^\d+$/.test(indexText) ? Number(indexText) : -1;
  const ids = metadata?.sessionIds;
  const directories = metadata?.directories;
  const sessionId = Array.isArray(ids) ? ids[index] : undefined;
  const directory = Array.isArray(directories) ? directories[index] : undefined;
  if (typeof sessionId !== "string" || typeof directory !== "string") {
    await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
    return true;
  }

  try {
    const { data: session, error } = await opencodeClient.session.get({ sessionID: sessionId, directory });
    if (error || !session || session.directory !== directory || session.parentID) {
      await ctx.answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true });
      return true;
    }
    if (getCurrentProject()?.worktree !== directory) {
      const project = { id: session.projectID, worktree: directory, name: directory };
      await switchToProject(ctx, project, "recent_project_switched", {
        ...deps,
        presentation: createProjectSwitchPresentation(deps),
      });
    }
    await selectSessionById(ctx, deps, sessionId, {
      source: "menu", deleteCallbackMessage: true, removeCallbackReplyMarkup: false,
      postSelectAction: "preview",
    });
  } catch (error) {
    deps.resetInteractions("recent_select_error");
    logger.error(`[Recent] Failed to select session ${sessionId} in ${directory}:`, error);
    await failure(ctx, "sessions.select_error");
  }
  return true;
}
