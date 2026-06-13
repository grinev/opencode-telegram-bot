import type { Context } from "grammy";
import type { ProjectSwitchPresentation } from "../../app/services/project-switch-service.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";

export function createProjectSwitchPresentation(): ProjectSwitchPresentation {
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
