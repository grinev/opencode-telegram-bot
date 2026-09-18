import { describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";
import { defined } from "../../helpers/defined.js";

const mocked = vi.hoisted(() => ({
  flushPendingPrompt: vi.fn(),
  opencodeStopCommand: vi.fn(),
}));

vi.mock("../../../src/bot/handlers/message-merger.js", () => ({
  flushPendingPrompt: mocked.flushPendingPrompt,
  __resetMessageMergerForTests: vi.fn(),
}));

vi.mock("../../../src/bot/commands/opencode-stop-command.js", () => ({
  opencodeStopCommand: mocked.opencodeStopCommand,
}));

import {
  ensureCommandsInitialized,
  registerCommandRouter,
} from "../../../src/bot/routers/command-router.js";
import { BOT_COMMANDS } from "../../../src/bot/commands/definitions.js";
import { config } from "../../../src/config.js";

describe("bot/routers/command-router", () => {
  it("registers bot slash command handlers", () => {
    const bot = { command: vi.fn(), use: vi.fn() };

    registerCommandRouter(bot as never, {
      ensureEventSubscription: vi.fn(),
      clearRuntimeState: vi.fn(),
    });

    expect(bot.command.mock.calls.map(([command]) => command)).toEqual([
      "start",
      "help",
      "status",
      "settings",
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
      "toggle_permissions",
    ]);
  });

  it("flushes a pending prompt before routing a command", async () => {
    const bot = { command: vi.fn(), use: vi.fn() };
    const next = vi.fn();
    registerCommandRouter(bot as never, {
      ensureEventSubscription: vi.fn(),
      clearRuntimeState: vi.fn(),
    });
    const middleware = defined(bot.use.mock.calls[0]?.[0]);
    const ctx = { chat: { id: 123 }, message: { text: "/new" } } as unknown as Context;

    await middleware(ctx, next);

    expect(mocked.flushPendingPrompt).toHaveBeenCalledWith(123);
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes clearRuntimeState to the opencode_stop handler", async () => {
    const bot = { command: vi.fn(), use: vi.fn() };
    const clearRuntimeState = vi.fn();
    mocked.opencodeStopCommand.mockReset();
    mocked.opencodeStopCommand.mockResolvedValue(undefined);

    registerCommandRouter(bot as never, {
      ensureEventSubscription: vi.fn(),
      clearRuntimeState,
    });

    const stopRegistration = bot.command.mock.calls.find(([command]) => command === "opencode_stop");
    expect(stopRegistration).toBeDefined();

    const ctx = { chat: { id: 123 } } as unknown as Context;
    await stopRegistration?.[1](ctx);

    expect(mocked.opencodeStopCommand).toHaveBeenCalledWith(ctx, { clearRuntimeState });
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
