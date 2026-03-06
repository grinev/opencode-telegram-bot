import { Context } from "grammy";
import { t } from "../../i18n/index.js";
import { getLocalizedBotCommands } from "./definitions.js";
import { createDmKeyboard } from "../utils/keyboard.js";

function formatHelpText(): string {
  const commands = getLocalizedBotCommands();
  const lines = commands.map((item) => `/${item.command} - ${item.description}`);

  return `📖 ${t("cmd.description.help")}\n\n${lines.join("\n")}\n\n${t("help.keyboard_hint")}`;
}

function formatDmHelpText(): string {
  const lines = [
    `/start - ${t("help.dm.command_start")}`,
    `/status - ${t("cmd.description.status")}`,
    `/help - ${t("cmd.description.help")}`,
    `/opencode_start - ${t("cmd.description.opencode_start")}`,
    `/opencode_stop - ${t("cmd.description.opencode_stop")}`,
  ];

  return `📖 ${t("help.dm.title")}\n\n${lines.join("\n")}\n\n${t("help.dm.hint")}`;
}

export async function helpCommand(ctx: Context): Promise<void> {
  if (ctx.chat?.type === "private") {
    await ctx.reply(formatDmHelpText(), {
      reply_markup: createDmKeyboard(),
    });
    return;
  }

  await ctx.reply(formatHelpText());
}
