import type { Context } from "grammy";
import type { ProjectSwitchPresentation } from "../../app/services/project-switch-service.js";
import { config } from "../../config.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";

export function createProjectSwitchPresentation(): ProjectSwitchPresentation {
  return {
    async clearPinnedMessage() {
      await pinnedMessageManager.clear();
    },
    initializeKeyboard(ctx: Context) {
      // Single-slot reply keyboard: never re-arm it from one operator's
      // project switch in multi-operator mode (same suppression as /start).
      const soloOperator = config.telegram.allowedUserIds.length <= 1;
      if (ctx.chat && soloOperator) {
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
