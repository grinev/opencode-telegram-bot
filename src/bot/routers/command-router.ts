import type { Bot, Context, NextFunction } from "grammy";
import { config } from "../../config.js";
import { settingsCommand } from "../commands/settings-command.js";
import { opencodeStartCommand } from "../commands/opencode-start-command.js";
import { opencodeStopCommand } from "../commands/opencode-stop-command.js";
import { projectsCommand } from "../commands/projects-command.js";
import { worktreeCommand } from "../commands/worktree-command.js";
import { openCommand } from "../commands/open-command.js";
import { lsCommand } from "../commands/ls-command.js";
import { sessionsCommand } from "../commands/sessions-command.js";
import { messagesCommand } from "../commands/messages-command.js";
import { newCommand } from "../commands/new-command.js";
import { abortCommand } from "../commands/abort-command.js";
import { detachCommand } from "../commands/detach-command.js";
import { taskCommand } from "../commands/task-command.js";
import { taskListCommand } from "../commands/tasklist-command.js";
import { renameCommand } from "../commands/rename-command.js";
import { commandsCommand } from "../commands/command-catalog-command.js";
import { skillsCommand } from "../commands/skills-catalog-command.js";
import { mcpsCommand } from "../commands/mcp-catalog-command.js";
import { startCommand } from "../commands/start-command.js";
import { helpCommand } from "../commands/help-command.js";
import { statusCommand } from "../commands/status-command.js";
import { BOT_COMMANDS } from "../commands/definitions.js";
import { logger } from "../../utils/logger.js";
import { flushPendingPrompt } from "../handlers/message-merger.js";
import {
  LocalCommandRegistry,
  type LocalCommandResult,
} from "../../app/services/local-command-registry.js";
import { sendMessageWithMarkdownFallback } from "../messages/send-with-markdown-fallback.js";
import { t } from "../../i18n/index.js";

interface CommandRouterDeps {
  ensureEventSubscription: (directory: string) => Promise<void>;
  clearRuntimeState: (reason: string) => void;
  localCommandRegistry?: LocalCommandRegistry;
}

let commandsInitialized = false;
export async function ensureCommandsInitialized(
  ctx: Context,
  next: NextFunction,
  localCommandRegistry = LocalCommandRegistry.empty(),
): Promise<void> {
  if (commandsInitialized || !ctx.from || ctx.from.id !== config.telegram.allowedUserId) {
    await next();
    return;
  }

  if (!ctx.chat) {
    logger.warn("[Bot] Cannot initialize commands: chat context is missing");
    await next();
    return;
  }

  try {
    await ctx.api.setMyCommands([...BOT_COMMANDS, ...localCommandRegistry.definitions()], {
      scope: {
        type: "chat",
        chat_id: ctx.chat.id,
      },
    });

    commandsInitialized = true;
    logger.debug(`[Bot] Commands initialized for authorized user (chat_id=${ctx.chat.id})`);
  } catch (err) {
    logger.error("[Bot] Failed to set commands:", err);
  }

  await next();
}

export function registerCommandRouter(bot: Bot<Context>, deps: CommandRouterDeps): void {
  const registry = deps.localCommandRegistry ?? LocalCommandRegistry.empty();
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.message?.text?.startsWith("/")) {
      flushPendingPrompt(ctx.chat.id);
    }
    await next();
  });

  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.command("status", statusCommand);
  bot.command("settings", settingsCommand);
  bot.command("opencode_start", opencodeStartCommand);
  bot.command("opencode_stop", (ctx) =>
    opencodeStopCommand(ctx, { clearRuntimeState: deps.clearRuntimeState }),
  );
  bot.command("projects", projectsCommand);
  bot.command("worktree", worktreeCommand);
  bot.command("open", openCommand);
  bot.command("ls", lsCommand);
  bot.command("sessions", sessionsCommand);
  bot.command("messages", messagesCommand);
  bot.command("new", (ctx) => newCommand(ctx, { bot, ensureEventSubscription: deps.ensureEventSubscription }));
  bot.command("abort", abortCommand);
  bot.command("detach", detachCommand);
  bot.command("task", taskCommand);
  bot.command("tasklist", taskListCommand);
  bot.command("rename", renameCommand);
  bot.command("commands", commandsCommand);
  bot.command("skills", skillsCommand);
  bot.command("mcps", mcpsCommand);
  for (const definition of registry.definitions()) {
    bot.command(definition.command, async (ctx) => {
      const result = await registry.execute(definition.command);
      if (!ctx.chat) return;
      await sendMessageWithMarkdownFallback({
        api: ctx.api,
        chatId: ctx.chat.id,
        text: localCommandReply(result),
      });
    });
  }
}

function localCommandReply(result: LocalCommandResult): string {
  switch (result.kind) {
    case "success": return result.text;
    case "empty": return t("local_command.empty_output");
    case "timeout": return t("local_command.timeout");
    case "failed": return t("local_command.failed", { exitCode: result.exitCode ?? "unknown", stderr: result.stderr });
  }
}
