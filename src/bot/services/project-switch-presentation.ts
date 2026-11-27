import type { Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import type { ProjectSwitchPresentation } from "../../app/services/project-switch-service.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";

export type ProjectSwitchPresentationDeps = Pick<
  AppContainer,
  "keyboardManager" | "sessionMetricsManager"
>;

export function createProjectSwitchPresentation(
  deps: ProjectSwitchPresentationDeps,
): ProjectSwitchPresentation {
  const { keyboardManager, sessionMetricsManager } = deps;

  return {
    initializeKeyboard(ctx: Context) {
      if (ctx.chat) {
        keyboardManager.initialize(ctx.api, ctx.chat.id);
      }
    },
    async refreshContextLimit() {
      await sessionMetricsManager.refreshContextLimit();
      return sessionMetricsManager.getContextLimit();
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
