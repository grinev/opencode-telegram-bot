import { getCurrentProject, getCurrentSession } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";
import { getProjectFolderName } from "../menus/project-selection-menu.js";

const MAX_NAME_LENGTH = 18;

export function getDashboardSelection() {
  const project = getCurrentProject();
  const session = getCurrentSession();
  return {
    project,
    session: project && session?.directory === project.worktree ? session : undefined,
  };
}

function shortName(name: string): string {
  const characters = Array.from(name.replace(/\s+/gu, " ").trim());
  return characters.length > MAX_NAME_LENGTH
    ? `${characters.slice(0, MAX_NAME_LENGTH - 1).join("")}…`
    : characters.join("");
}

export function getDashboardButtonLabel(previousTitle?: string): string {
  const { project, session } = getDashboardSelection();
  const projectName = project && getProjectFolderName(project.name?.trim() || project.worktree);
  return t("dashboard.button.context", {
    project: (projectName && shortName(projectName)) || t("dashboard.button.no_project"),
    session: session
      ? shortName((previousTitle ?? session.title).trim() || t("dashboard.button.unnamed_session"))
      : t("dashboard.button.no_session"),
  });
}
