import { Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { t } from "../../i18n/index.js";

export const COMMIT_CONFIRM_CALLBACK = "commit:go";
export const COMMIT_REGENERATE_CALLBACK = "commit:regen";
export const COMMIT_EDIT_CALLBACK = "commit:edit";
export const COMMIT_CANCEL_CALLBACK = "commit:cancel";

export const COMMIT_FLOW = "commit";

function buildCommitConfirmKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard.text(t("commit.button.confirm"), COMMIT_CONFIRM_CALLBACK).row();
  keyboard
    .text(t("commit.button.regenerate"), COMMIT_REGENERATE_CALLBACK)
    .text(t("commit.button.edit"), COMMIT_EDIT_CALLBACK)
    .row();
  keyboard.text(t("inline.button.cancel"), COMMIT_CANCEL_CALLBACK);
  return keyboard;
}

/**
 * Show the commit confirmation message and (re)start the commit interaction
 * in the confirm stage.
 */
export async function showCommitConfirmation(
  ctx: Context,
  dir: string,
  message: string,
  generated: boolean,
): Promise<void> {
  let text = t("commit.confirm_title", { message });
  if (!generated) {
    text += `\n\n${t("commit.generation_fallback")}`;
  }

  const sent = await ctx.reply(text, { reply_markup: buildCommitConfirmKeyboard() });

  interactionManager.start({
    kind: "custom",
    expectedInput: "callback",
    metadata: {
      flow: COMMIT_FLOW,
      stage: "confirm",
      dir,
      message,
      messageId: sent.message_id,
    },
  });
}
