import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import type { ProjectSwitchPresentation } from "../../app/services/project-switch-service.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";

export type ProjectSwitchPresentationDeps = Pick<
  AppContainer,
  "keyboardManager" | "pinnedMessageManager"
>;

export function createProjectSwitchPresentation(
  deps: ProjectSwitchPresentationDeps,
): ProjectSwitchPresentation {
  const { keyboardManager, pinnedMessageManager } = deps;

  return {
    async clearPinnedMessage() {
      await pinnedMessageManager.clear();
    },
    initializeKeyboard(ctx: Context) {
      if (ctx.chat) {
        keyboardManager.initialize(ctx.api, ctx.chat.id);
      }
    },
    async refreshContextLimit() {
      await pinnedMessageManager.refreshContextLimit();
      return pinnedMessageManager.getContextLimit();
    },
    updateKeyboardContext(contextInfo) {
      keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
    },
    updateKeyboardAgent(agent) {
      keyboardManager.updateAgent(agent);
    },
    createMainKeyboard,
  };
}
