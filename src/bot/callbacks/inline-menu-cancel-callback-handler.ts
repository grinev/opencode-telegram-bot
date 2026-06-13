import type { Context } from "grammy";
import {
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  INLINE_MENU_CANCEL_PREFIX,
  isInlineMenuKind,
  LEGACY_CONTEXT_CANCEL_CALLBACK,
  type InlineMenuKind,
} from "../menus/inline-menu.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export async function handleInlineMenuCancel(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  let menuKind: InlineMenuKind | null = null;

  if (data === LEGACY_CONTEXT_CANCEL_CALLBACK) {
    menuKind = "context";
  } else if (data.startsWith(INLINE_MENU_CANCEL_PREFIX)) {
    const rawKind = data.slice(INLINE_MENU_CANCEL_PREFIX.length);
    if (!isInlineMenuKind(rawKind)) {
      return false;
    }

    menuKind = rawKind;
  } else {
    return false;
  }

  const isActive = await ensureActiveInlineMenu(ctx, menuKind);
  if (!isActive) {
    return true;
  }

  clearActiveInlineMenu(`inline_menu_cancel:${menuKind}`);

  await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
  await ctx.deleteMessage().catch(() => {});

  logger.debug(`[InlineMenu] Menu cancelled: kind=${menuKind}`);

  return true;
}
