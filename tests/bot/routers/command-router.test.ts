import { describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";
import {
  ensureCommandsInitialized,
  registerCommandRouter,
} from "../../../src/bot/routers/command-router.js";
import { BOT_COMMANDS } from "../../../src/bot/commands/definitions.js";
import { config } from "../../../src/config.js";

describe("bot/routers/command-router", () => {
  it("registers bot slash command handlers", () => {
    const bot = { command: vi.fn() };

    registerCommandRouter(bot as never, { ensureEventSubscription: vi.fn() });

    expect(bot.command.mock.calls.map(([command]) => command)).toEqual([
      "start",
      "help",
      "status",
      "tts",
      "opencode_start",
      "opencode_stop",
      "projects",
      "worktree",
      "open",
      "ls",
      "sessions",
      "messages",
      "new",
      "abort",
      "detach",
      "task",
      "tasklist",
      "rename",
      "commands",
      "skills",
      "mcps",
    ]);
  });

  it("initializes commands for the authorized chat", async () => {
    const next: NextFunction = vi.fn();
    const ctx = {
      from: { id: config.telegram.allowedUserId },
      chat: { id: 123 },
      api: { setMyCommands: vi.fn() },
    } as unknown as Context;

    await ensureCommandsInitialized(ctx, next);

    expect(ctx.api.setMyCommands).toHaveBeenCalledWith(BOT_COMMANDS, {
      scope: { type: "chat", chat_id: 123 },
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
