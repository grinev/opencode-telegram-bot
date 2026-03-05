import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { helpCommand } from "../../../src/bot/commands/help.js";
import { getLocalizedBotCommands } from "../../../src/bot/commands/definitions.js";

describe("bot/commands/help", () => {
  it("returns full commands list from centralized definitions", async () => {
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      reply: replyMock,
    } as unknown as Context;

    await helpCommand(ctx);

    expect(replyMock).toHaveBeenCalledTimes(1);

    const helpText = replyMock.mock.calls[0][0] as string;
    const commands = getLocalizedBotCommands();

    for (const item of commands) {
      expect(helpText).toContain(`/${item.command}`);
      expect(helpText).toContain(item.description);
    }
  });

  it("returns DM-specific help in private chat", async () => {
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 1, type: "private" },
      reply: replyMock,
    } as unknown as Context;

    await helpCommand(ctx);

    expect(replyMock).toHaveBeenCalledTimes(1);
    const helpText = replyMock.mock.calls[0][0] as string;
    expect(helpText).toContain("/status");
    expect(helpText).toContain("/opencode_start");
    expect(helpText).not.toContain("/projects");
    expect(helpText).not.toContain("/sessions");
  });
});
