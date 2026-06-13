import { InlineKeyboard } from "grammy";
import { t } from "../../i18n/index.js";

export const RENAME_CANCEL_CALLBACK = "rename:cancel";

export function buildRenameCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(t("rename.button.cancel"), RENAME_CANCEL_CALLBACK);
}
