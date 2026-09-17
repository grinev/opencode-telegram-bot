import type { Context } from "grammy";
import {
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
  INLINE_MENU_CANCEL_PREFIX,
  isInlineMenuKind,
  LEGACY_CONTEXT_CANCEL_CALLBACK,
  type InlineMenuDeps,
  type InlineMenuKind,
} from "../menus/inline-menu.js";
import { logger } from "../../utils/logger.js";
import { cancelMenu } from "./feedback.js";

export async function handleInlineMenuCancel(
  ctx: Context,
  deps: InlineMenuDeps,
): Promise<boolean> {
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

  const isActive = await ensureActiveInlineMenu(ctx, menuKind, deps);
  if (!isActive) {
    return true;
  }

  clearActiveInlineMenu(`inline_menu_cancel:${menuKind}`, deps);

  await cancelMenu(ctx);

  logger.debug(`[InlineMenu] Menu cancelled: kind=${menuKind}`);

  return true;
}
