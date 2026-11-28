import type { AppContainer } from "../../app/bootstrap/app-container.js";
import type { AttachPresentationDeps } from "../../app/services/attach-service.js";
import { getDashboardButtonLabel } from "../keyboards/dashboard-button.js";
import {
  applyPermissionPromptChanges,
  showPermissionRequest,
  type PermissionMenuDeps,
} from "../menus/permission-menu.js";
import {
  closeQuestionNotAnswered,
  closeQuestionSettledOutside,
  showCurrentQuestion,
  type QuestionMenuDeps,
} from "../menus/question-menu.js";

type AttachPresentationFactoryDeps = Pick<AppContainer, "keyboardManager" | "sessionMetricsManager"> &
  PermissionMenuDeps &
  QuestionMenuDeps;

export function createAttachPresentation(
  deps: AttachPresentationFactoryDeps,
): AttachPresentationDeps {
  const { keyboardManager, sessionMetricsManager } = deps;

  return {
    async prepareSessionMetrics({
      api,
      chatId,
      session,
      forceFullRestore = false,
      sessionCreated = false,
    }) {
      keyboardManager.initialize(api, chatId);
      await sessionMetricsManager.prepare(session, { force: forceFullRestore, created: sessionCreated });
      const contextInfo = sessionMetricsManager.getContextInfo();
      if (contextInfo) {
        keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
      }
    },
    async refreshRestoredSelection(api, chatId, previousTitle) {
      if (previousTitle !== undefined && getDashboardButtonLabel(previousTitle) === getDashboardButtonLabel()) {
        return;
      }
      keyboardManager.initialize(api, chatId);
      await keyboardManager.sendKeyboardUpdate(chatId);
    },
    notifySessionRestored(chatId, session) {
      void keyboardManager.sendKeyboardUpdate(chatId, session);
    },
    showCurrentQuestion: (api, chatId) => showCurrentQuestion(api, chatId, deps),
    showPermissionRequest: (api, chatId, request) =>
      showPermissionRequest(api, chatId, request, deps),
    applyPermissionPromptChanges: (api, chatId, changes) =>
      applyPermissionPromptChanges(api, chatId, changes, deps),
    closeQuestionSettledOutside: (api, chatId) =>
      closeQuestionSettledOutside(api, chatId, "answered", deps),
    closeQuestionNotAnswered: (api, chatId) => closeQuestionNotAnswered(api, chatId, deps),
  };
}
