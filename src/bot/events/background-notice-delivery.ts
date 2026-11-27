import {
  getCurrentProject,
  getShowBackgroundSessionNotifications,
} from "../../app/stores/settings-store.js";
import { config } from "../../config.js";
import { opencodeClient } from "../../opencode/client.js";
import { formatSessionTitle } from "../../app/formatters/session-title-formatter.js";
import { createProjectPathExclusionMatcher } from "../../app/services/project-path-exclusions.js";
import { fetchSessionTitle } from "../../app/services/session-service.js";
import { loadRecentSessionDirectories } from "../../app/services/recent-sessions-service.js";
import { normalizePathKey } from "../../app/services/worktree-service.js";
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

async function resolveNoticeSession({
  sessionId,
  sessionDirectory,
  directoryHint,
}: BackgroundSessionNotification) {
  const directory = directoryHint ?? sessionDirectory;
  try {
    const { data, error } = await opencodeClient.session.get({
      sessionID: sessionId,
      ...(directory ? { directory } : {}),
    });
    if (!error && data?.id === sessionId) return data;
    logger.debug(`[BackgroundNotice] Could not confirm session ${sessionId}:`, error);
  } catch (error) {
    logger.debug(`[BackgroundNotice] Could not confirm session ${sessionId}:`, error);
  }
  return undefined;
}

async function formatAssistantResponseNotification(
  notification: BackgroundSessionNotification,
  sessionDirectory: string | undefined,
  confirmedTitle: string | undefined,
): Promise<string> {
  const directory = sessionDirectory?.trim() || getCurrentProject()?.worktree?.trim() || "";
  const [session, project] = await Promise.all([
    confirmedTitle === undefined
      ? resolveAssistantSessionTitle(notification, directory)
      : formatSessionTitle(confirmedTitle.trim()),
    resolveProjectLabel(directory),
  ]);
  const key = notification.kind === "context_compacted"
    ? "context.background_success"
    : "background.assistant_response";
  return t(key, { project, session });
}

async function formatBackgroundSessionNotification(
  notification: BackgroundSessionNotification,
  directory: string | undefined,
  confirmedTitle: string | undefined,
): Promise<string> {
  switch (notification.kind) {
    case "assistant_response":
    case "context_compacted":
      return formatAssistantResponseNotification(notification, directory, confirmedTitle);
    case "question_asked":
      return t("background.question_asked", { session: getBackgroundSessionLabel(notification) });
    case "permission_asked":
      return t("background.permission_asked", { session: getBackgroundSessionLabel(notification) });
  }
}

/** Sends a background-session notice to the destination of its own session. */
export function createBackgroundNoticeDelivery(
  policy: SessionTargetPolicy,
  delivery: TelegramEventDelivery,
): (notification: BackgroundSessionNotification) => Promise<void> {
  return async (notification) => {
    const compaction = notification.kind === "context_compacted";
    const canNotify = () =>
      getShowBackgroundSessionNotifications() &&
      !policy.isForegroundSession(notification.sessionId);
    const inScope = (directory: string | undefined) => {
      // Spontaneous notices come from a worktree subscription. Its scope is
      // independent of the session's own directory used for exclusions.
      const scope = compaction ? directory : notification.directoryHint;
      if (!compaction && !scope) return true;
      const project = getCurrentProject()?.worktree;
      return Boolean(project && scope && normalizePathKey(project) === normalizePathKey(scope));
    };

    if (!canNotify() || (!compaction && !inScope(undefined))) return;
    const destination = policy.getDestination(notification.sessionId);
    if (!destination) return;

    const isExcluded = createProjectPathExclusionMatcher(config.bot.excludedProjectPaths);
    let directory = notification.sessionDirectory;
    if (directory?.trim() && isExcluded?.(directory)) return;

    let confirmedTitle: string | undefined;
    if (!compaction || (isExcluded && !directory?.trim())) {
      const session = await resolveNoticeSession(notification);
      // Absence of a parent is evidence only on a full session record, not in SSE metadata.
      if (!compaction && (!session || session.parentID)) return;
      if (session?.directory?.trim()) directory = session.directory;
      confirmedTitle = session?.title ?? (compaction ? undefined : (notification.sessionTitle ?? ""));
    }
    if (isExcluded && (!directory?.trim() || isExcluded(directory))) return;
    if (!isExcluded && !directory?.trim()) directory = notification.directoryHint;
    if (!inScope(directory)) return;

    const text = await formatBackgroundSessionNotification(notification, directory, confirmedTitle);
    if (!canNotify() || !inScope(directory)) return;
    await delivery.sendText(destination, text, {
      reply_markup: buildBackgroundSessionOpenKeyboard(notification.sessionId, notification.kind),
    });
  };
}
