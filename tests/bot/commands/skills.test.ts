import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { skillsCommand } from "../../../src/bot/commands/skills.js";
import { getCurrentSession } from "../../../src/session/manager.js";

const mocked = vi.hoisted(() => ({
  currentSession: null as { id: string; title: string; directory: string } | null,
  commandListMock: vi.fn(),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    command: {
      list: mocked.commandListMock,
    },
    session: {
      command: vi.fn(),
    },
  },
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  replyWithInlineMenu: vi.fn(),
}));

function createReplyContext(): Context {
  return {
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

describe("bot/commands/skills", () => {
  beforeEach(() => {
    mocked.currentSession = null;
    mocked.commandListMock.mockReset();
  });

  it("blocks when no active session", async () => {
    const ctx = createReplyContext();
    mocked.currentSession = null;

    await skillsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("No active session"));
    expect(mocked.commandListMock).not.toHaveBeenCalled();
  });

  it("shows empty message when no commands available", async () => {
    const ctx = createReplyContext();
    mocked.currentSession = {
      id: "session-1",
      title: "Test Session",
      directory: "/test/dir",
    };
    mocked.commandListMock.mockResolvedValue({ data: [], error: null });

    await skillsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("No skills"));
  });

  it("shows menu when commands are available", async () => {
    const ctx = createReplyContext();
    mocked.currentSession = {
      id: "session-1",
      title: "Test Session",
      directory: "/test/dir",
    };
    const mockCommands = [
      { name: "skill1", description: "Description 1", template: "", hints: [] },
      { name: "skill2", description: "Description 2", template: "", hints: [] },
    ];
    mocked.commandListMock.mockResolvedValue({ data: mockCommands, error: null });

    await skillsCommand(ctx as never);

    expect(mocked.commandListMock).toHaveBeenCalledWith({
      directory: "/test/dir",
    });
  });

  it("handles fetch error gracefully", async () => {
    const ctx = createReplyContext();
    mocked.currentSession = {
      id: "session-1",
      title: "Test Session",
      directory: "/test/dir",
    };
    mocked.commandListMock.mockResolvedValue({
      data: null,
      error: new Error("Fetch failed"),
    });

    await skillsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("unavailable"));
  });
});
