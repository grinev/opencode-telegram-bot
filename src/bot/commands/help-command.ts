import { Context } from "grammy";
import { t } from "../../i18n/index.js";
import { getLocalizedBotCommands } from "./definitions.js";

function formatHelpText(): string {
  const commands = getLocalizedBotCommands();
  const lines = commands.map((item) => `/${item.command} - ${item.description}`);

  return `📖 ${t("cmd.description.help")}\n\n${lines.join("\n")}\n\n${t("help.keyboard_hint")}`;
}

export async function helpCommand(ctx: Context): Promise<void> {
  await ctx.reply(formatHelpText());
}
