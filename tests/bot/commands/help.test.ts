import { describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
const { helpCommand } = await loadSut<typeof import("#src/bot/commands/help-command.js")>(
  "#src/bot/commands/help-command.ts",
  import.meta.url,
);
const { getLocalizedBotCommands } = await loadSut<typeof import("#src/bot/commands/definitions.js")>(
  "#src/bot/commands/definitions.ts",
  import.meta.url,
);
import { defined } from "#helpers/defined.js";

describe("bot/commands/help-command", () => {
  it("returns full commands list from centralized definitions", async () => {
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      reply: replyMock,
    } as unknown as Context;

    await helpCommand(ctx);

    expect(replyMock).toHaveBeenCalledTimes(1);

    const helpText = defined(replyMock.mock.calls[0]?.[0]) as string;
    const commands = getLocalizedBotCommands();

    for (const item of commands) {
      expect(helpText).toContain(`/${item.command}`);
      expect(helpText).toContain(item.description);
    }
  });
});
