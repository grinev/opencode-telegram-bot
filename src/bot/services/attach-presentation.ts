import type { AttachPresentationDeps } from "../../app/services/attach-service.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { config } from "../../config.js";
import { showPermissionRequest } from "../menus/permission-menu.js";
import { showCurrentQuestion } from "../menus/question-menu.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";

export function createAttachPresentation(): AttachPresentationDeps {
  // The pinned status card and the reply keyboard are single-slot legacy
  // affordances: with multiple operators they would pin into ONE human's chat
  // (whichever operator initialized them first - /start and /status arm them
  // directly) and every operator's activity would tick there. Multi-operator
  // mode therefore never uses them, regardless of initialization state; each
  // bound chat gets its own streamers instead.
  const isMultiOperator = config.telegram.allowedUserIds.length > 1;

  return {
    async ensurePinnedSession({ api, chatId, session, forceFullRestore = false }) {
      if (isMultiOperator) {
        return;
      }

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
      if (isMultiOperator || !pinnedMessageManager.isInitialized()) {
        return;
      }

      await pinnedMessageManager.setAttachState(attached, busy);
    },
    showCurrentQuestion,
    showPermissionRequest,
  };
}
