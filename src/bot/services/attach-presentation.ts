import type { AppContainer } from "../../app/bootstrap/app-container.js";
import type { AttachPresentationDeps } from "../../app/services/attach-service.js";
import { showPermissionRequest, type PermissionMenuDeps } from "../menus/permission-menu.js";
import { showCurrentQuestion, type QuestionMenuDeps } from "../menus/question-menu.js";

type AttachPresentationFactoryDeps = Pick<AppContainer, "keyboardManager" | "pinnedMessageManager"> &
  PermissionMenuDeps &
  QuestionMenuDeps;

export function createAttachPresentation(
  deps: AttachPresentationFactoryDeps,
): AttachPresentationDeps {
  const { keyboardManager, pinnedMessageManager } = deps;

  return {
    async ensurePinnedSession({ api, chatId, session, forceFullRestore = false }) {
      if (!pinnedMessageManager.isInitialized()) {
        pinnedMessageManager.initialize(api, chatId);
      }

      keyboardManager.initialize(api, chatId);

      const pinnedState = pinnedMessageManager.getState();
      if (pinnedState.sessionId === session.id && pinnedState.messageId) {
        if (forceFullRestore) {
          await pinnedMessageManager.loadContextFromHistory(session.id, session.directory);
        }
        return;
      }

      if (pinnedState.messageId && pinnedState.sessionId === null) {
        await pinnedMessageManager.restoreExistingSession(session.id, session.title);
      } else {
        await pinnedMessageManager.onSessionChange(session.id, session.title);
      }

      await pinnedMessageManager.loadContextFromHistory(session.id, session.directory);

      const contextInfo = pinnedMessageManager.getContextInfo();
      if (contextInfo) {
        keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
      }
    },
    async syncAttachState(attached, busy) {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      await pinnedMessageManager.setAttachState(attached, busy);
    },
    showCurrentQuestion: (api, chatId) => showCurrentQuestion(api, chatId, deps),
    showPermissionRequest: (api, chatId, request) =>
      showPermissionRequest(api, chatId, request, deps),
  };
}
