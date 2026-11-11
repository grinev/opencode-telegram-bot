import {
  getCurrentProject,
  getShowBackgroundSessionNotifications,
} from "../../app/stores/settings-store.js";
import { config } from "../../config.js";
import { formatSessionTitle } from "../../app/formatters/session-title-formatter.js";
import { fetchSessionTitle } from "../../app/services/session-service.js";
import { loadRecentSessionDirectories } from "../../app/services/recent-sessions-service.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import type { BackgroundSessionNotification } from "../../app/managers/background-session-manager.js";
import { resolveProjectName } from "../menus/project-name.js";
import { buildBackgroundSessionOpenKeyboard } from "../menus/session-selection-menu.js";
import type { SessionTargetPolicy, TelegramEventDelivery } from "./telegram-event-delivery.js";

function formatShortSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}

function getBackgroundSessionLabel(notification: BackgroundSessionNotification): string {
  const title = notification.sessionTitle?.trim();
  if (title) {
    return title;
  }

  return t("background.session_fallback", {
    id: formatShortSessionId(notification.sessionId),
  });
}

/** The project label `/recent` would show for this folder among the folders it lists now. */
async function resolveProjectLabel(directory: string): Promise<string> {
  try {
    const directories = await loadRecentSessionDirectories(config.bot.sessionsListLimit);
    return resolveProjectName(
      directory,
      directories.includes(directory) ? directories : [...directories, directory],
    );
  } catch (error) {
    logger.debug(
      `[BackgroundNotice] Could not load the recent projects for ${directory}; using the folder name:`,
      error,
    );
    return resolveProjectName(directory, [directory]);
  }
}

async function resolveAssistantSessionTitle(
  notification: BackgroundSessionNotification,
  directory: string,
): Promise<string> {
  const remembered = notification.sessionTitle?.trim() ?? "";
  const title = directory
    ? await fetchSessionTitle({ id: notification.sessionId, title: remembered, directory })
    : remembered;
  return formatSessionTitle(title.trim());
}

async function formatAssistantResponseNotification(
  notification: BackgroundSessionNotification,
): Promise<string> {
  const directory =
    notification.sessionDirectory?.trim() || getCurrentProject()?.worktree?.trim() || "";
  const [session, project] = await Promise.all([
    resolveAssistantSessionTitle(notification, directory),
    resolveProjectLabel(directory),
  ]);
  return t("background.assistant_response", { project, session });
}

async function formatBackgroundSessionNotification(
  notification: BackgroundSessionNotification,
): Promise<string> {
  switch (notification.kind) {
    case "assistant_response":
      return formatAssistantResponseNotification(notification);
    case "question_asked":
      return t("background.question_asked", { session: getBackgroundSessionLabel(notification) });
    case "permission_asked":
      return t("background.permission_asked", { session: getBackgroundSessionLabel(notification) });
  }
}

/** Sends a background-session notice to the destination of its own session. */
export function createBackgroundNoticeDelivery(
  policy: Pick<SessionTargetPolicy, "getDestination">,
  delivery: TelegramEventDelivery,
): (notification: BackgroundSessionNotification) => Promise<void> {
  return async (notification) => {
    if (!getShowBackgroundSessionNotifications()) {
      return;
    }

    const destination = policy.getDestination(notification.sessionId);
    if (!destination) {
      return;
    }

    await delivery.sendText(destination, await formatBackgroundSessionNotification(notification), {
      reply_markup: buildBackgroundSessionOpenKeyboard(notification.sessionId, notification.kind),
    });
  };
}
