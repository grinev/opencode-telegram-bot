import type { CommandContext, Context } from "grammy";
import { buildSettingsMenuView } from "../menus/settings-menu.js";
import { replyWithInlineMenu, type InlineMenuDeps } from "../menus/inline-menu.js";

export async function settingsCommand(
  ctx: CommandContext<Context>,
  deps: InlineMenuDeps,
): Promise<void> {
  const { text, keyboard } = buildSettingsMenuView();

  await replyWithInlineMenu(ctx, {
    menuKind: "settings",
    text,
    keyboard,
  }, deps);
}
