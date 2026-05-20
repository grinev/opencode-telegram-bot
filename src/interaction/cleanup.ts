import { permissionManager } from "../permission/manager.js";
import { questionManager } from "../question/manager.js";
import { taskCreationManager } from "../scheduled-task/creation-manager.js";
import { interactionManager } from "./manager.js";
import { logger } from "../utils/logger.js";

export function clearAllInteractionState(reason: string): void {
  const questionActive = questionManager.isActive();
  const permissionActive = permissionManager.isActive();
  const taskCreationActive = taskCreationManager.isActive();
  const interactionSnapshot = interactionManager.getSnapshot();

  questionManager.clear();
  permissionManager.clear();
  taskCreationManager.clear();
  interactionManager.clear(reason);

  const hasAnyActiveState =
    questionActive ||
    permissionActive ||
    taskCreationActive ||
    interactionSnapshot !== null;

  const message =
    `[InteractionCleanup] Cleared state: reason=${reason}, ` +
    `questionActive=${questionActive}, permissionActive=${permissionActive}, ` +
    `taskCreationActive=${taskCreationActive}, ` +
    `interactionKind=${interactionSnapshot?.kind || "none"}`;

  if (hasAnyActiveState) {
    logger.info(message);
    return;
  }

  logger.debug(message);
}
