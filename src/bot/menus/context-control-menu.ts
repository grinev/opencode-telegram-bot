import { Context, InlineKeyboard } from "grammy";
import { getCurrentSession } from "../../app/services/session-service.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { replyWithInlineMenu } from "./inline-menu.js";

/**
 * Build inline keyboard with compact confirmation menu
 * @returns InlineKeyboard with confirmation button
 */
export function buildCompactConfirmationMenu(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text(t("context.button.confirm"), "compact:confirm");

  return keyboard;
}

/**
 * Handle context button press (text message from Reply Keyboard)
 * Shows inline menu with compact confirmation
 * @param ctx grammY context
 */
export async function handleContextButtonPress(ctx: Context): Promise<void> {
  logger.debug("[ContextHandler] Context button pressed");

  const session = getCurrentSession();

  if (!session) {
    await ctx.reply(t("context.no_active_session"));
    return;
  }

  const keyboard = buildCompactConfirmationMenu();

  await replyWithInlineMenu(ctx, {
    menuKind: "context",
    text: t("context.confirm_text", { title: session.title }),
    keyboard,
  });
}
