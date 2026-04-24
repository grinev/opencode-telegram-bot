import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { mcpsCommand, handleMcpsCallback } from "../../../src/bot/commands/mcps.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  mcpStatusMock: vi.fn(),
  mcpConnectMock: vi.fn(),
  mcpDisconnectMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    mcp: {
      status: mocked.mcpStatusMock,
      connect: mocked.mcpConnectMock,
      disconnect: mocked.mcpDisconnectMock,
    },
  },
}));

function createCommandContext(messageId: number): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    reply: vi.fn().mockResolvedValue({ message_id: 901 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 902 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

describe("bot/commands/mcps", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Repo",
    };

    mocked.mcpStatusMock.mockReset();
    mocked.mcpConnectMock.mockReset();
    mocked.mcpDisconnectMock.mockReset();
  });

  it("shows empty message when no project is selected", async () => {
    mocked.currentProject = null;

    const ctx = createCommandContext(100);
    await mcpsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("bot.project_not_selected"));
  });

  it("shows empty message when no MCP servers configured", async () => {
    mocked.mcpStatusMock.mockResolvedValue({ data: {}, error: null });

    const ctx = createCommandContext(101);
    await mcpsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("mcps.empty"));
  });

  it("shows MCP servers list and starts custom interaction", async () => {
    mocked.mcpStatusMock.mockResolvedValue({
      data: {
        filesystem: { status: "connected" },
        github: { status: "disabled" },
      },
      error: null,
    });

    const ctx = createCommandContext(102);
    await mcpsCommand(ctx as never);

    expect(mocked.mcpStatusMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];

    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("mcps:select:filesystem");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("mcps:select:github");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("mcps:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.flow).toBe("mcps");
    expect(state?.metadata.stage).toBe("list");
    expect(state?.metadata.messageId).toBe(102);
  });

  it("shows fetch error when API fails", async () => {
    mocked.mcpStatusMock.mockResolvedValue({ data: null, error: new Error("API error") });

    const ctx = createCommandContext(103);
    await mcpsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("mcps.fetch_error"));
  });

  it("transitions to detail view after selecting a server", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: 200,
        projectDirectory: "D:\\Projects\\Repo",
        servers: [
          { name: "filesystem", status: { status: "connected" } },
          { name: "github", status: { status: "disabled" } },
        ],
      },
    });

    const ctx = createCallbackContext("mcps:select:github", 200);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining(t("mcps.detail.title", { name: "github" })),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.metadata.stage).toBe("detail");
    expect(state?.metadata.serverName).toBe("github");
  });

  it("disables a connected server", async () => {
    mocked.mcpDisconnectMock.mockResolvedValue({ error: null });
    mocked.mcpStatusMock.mockResolvedValue({
      data: {
        filesystem: { status: "disabled" },
      },
      error: null,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "detail",
        messageId: 300,
        projectDirectory: "D:\\Projects\\Repo",
        serverName: "filesystem",
        servers: [{ name: "filesystem", status: { status: "connected" } }],
      },
    });

    const ctx = createCallbackContext("mcps:toggle:filesystem", 300);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.mcpDisconnectMock).toHaveBeenCalledWith({
      name: "filesystem",
      directory: "D:/Projects/Repo",
    });

    const state = interactionManager.getSnapshot();
    expect(state?.metadata.stage).toBe("detail");
    expect(state?.metadata.serverName).toBe("filesystem");
  });

  it("enables a disabled server", async () => {
    mocked.mcpConnectMock.mockResolvedValue({ error: null });
    mocked.mcpStatusMock.mockResolvedValue({
      data: {
        github: { status: "connected" },
      },
      error: null,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "detail",
        messageId: 400,
        projectDirectory: "D:\\Projects\\Repo",
        serverName: "github",
        servers: [{ name: "github", status: { status: "disabled" } }],
      },
    });

    const ctx = createCallbackContext("mcps:toggle:github", 400);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.mcpConnectMock).toHaveBeenCalledWith({
      name: "github",
      directory: "D:/Projects/Repo",
    });

    const state = interactionManager.getSnapshot();
    expect(state?.metadata.stage).toBe("detail");
    expect(state?.metadata.serverName).toBe("github");
  });

  it("returns to list view on back button", async () => {
    mocked.mcpStatusMock.mockResolvedValue({
      data: {
        filesystem: { status: "connected" },
      },
      error: null,
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "detail",
        messageId: 500,
        projectDirectory: "D:\\Projects\\Repo",
        serverName: "filesystem",
        servers: [{ name: "filesystem", status: { status: "connected" } }],
      },
    });

    const ctx = createCallbackContext("mcps:back", 500);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      t("mcps.select"),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const state = interactionManager.getSnapshot();
    expect(state?.metadata.stage).toBe("list");
  });

  it("cancels and deletes message", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        servers: [{ name: "filesystem", status: { status: "connected" } }],
      },
    });

    const ctx = createCallbackContext("mcps:cancel", 600);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("inline.cancelled_callback") });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("handles stale callback as inactive", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: 700,
        projectDirectory: "D:\\Projects\\Repo",
        servers: [{ name: "filesystem", status: { status: "connected" } }],
      },
    });

    const ctx = createCallbackContext("mcps:cancel", 999);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
    expect(interactionManager.getSnapshot()?.kind).toBe("custom");
  });

  it("does not show enable button for needs_auth status", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: 800,
        projectDirectory: "D:\\Projects\\Repo",
        servers: [{ name: "oauth-server", status: { status: "needs_auth" } }],
      },
    });

    const ctx = createCallbackContext("mcps:select:oauth-server", 800);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining(t("mcps.auth_required")),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];

    const hasToggleButton = options.reply_markup.inline_keyboard.some((row) =>
      row.some((btn) => btn.callback_data?.startsWith("mcps:toggle:")),
    );
    expect(hasToggleButton).toBe(false);
  });

  it("shows toggle error on API failure", async () => {
    mocked.mcpConnectMock.mockResolvedValue({ error: new Error("Connection failed") });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "detail",
        messageId: 900,
        projectDirectory: "D:\\Projects\\Repo",
        serverName: "github",
        servers: [{ name: "github", status: { status: "disabled" } }],
      },
    });

    const ctx = createCallbackContext("mcps:toggle:github", 900);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("mcps.toggle_error") });
  });
});
