import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import {
  commandsCommand,
  handleCommandTextArguments,
  handleCommandsCallback,
  type ExecuteCommandDeps,
  parseCommandPageCallback,
  formatCommandsSelectText,
  calculateCommandsPaginationRange,
} from "../../../src/bot/commands/commands.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";
import { foregroundSessionState } from "../../../src/scheduled-task/foreground-state.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  currentSession: {
    id: "session-1",
    title: "Session",
    directory: "D:\\Projects\\Repo",
  } as { id: string; title: string; directory: string } | null,
  commandListMock: vi.fn(),
  sessionStatusMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  sessionCommandMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
  ingestSessionInfoForCacheMock: vi.fn(),
  setSessionSummaryMock: vi.fn(),
  setBotAndChatIdMock: vi.fn(),
  clearSummaryMock: vi.fn(),
  ensureEventSubscriptionMock: vi.fn(),
  safeBackgroundTaskMock: vi.fn(),
  suppressionRegisterMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: vi.fn((session) => {
    mocked.currentSession = session;
    mocked.setCurrentSessionMock(session);
  }),
  clearSession: vi.fn(() => {
    mocked.currentSession = null;
    mocked.clearSessionMock();
  }),
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: mocked.ingestSessionInfoForCacheMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    command: {
      list: mocked.commandListMock,
    },
    session: {
      status: mocked.sessionStatusMock,
      create: mocked.sessionCreateMock,
      command: mocked.sessionCommandMock,
    },
  },
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: mocked.setSessionSummaryMock,
    setBotAndChatId: mocked.setBotAndChatIdMock,
    clear: mocked.clearSummaryMock,
  },
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
  resolveProjectAgent: vi.fn(async (agentName?: string) => agentName ?? "build"),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({
    providerID: "openai",
    modelID: "gpt-5",
    variant: "default",
  })),
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: vi.fn((options) => {
    mocked.safeBackgroundTaskMock(options);
    try {
      const taskPromise = options.task();
      void Promise.resolve(taskPromise)
        .then((result) => {
          if (options.onSuccess) {
            return options.onSuccess(result);
          }
        })
        .catch((error) => {
          if (options.onError) {
            return options.onError(error);
          }
        });
    } catch (error) {
      if (options.onError) {
        void options.onError(error);
      }
    }
  }),
}));

vi.mock("../../../src/external-input/suppression.js", () => ({
  externalUserInputSuppressionManager: {
    register: mocked.suppressionRegisterMock,
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

function createTextContext(text: string): Context {
  return {
    chat: { id: 777 },
    message: { text } as Context["message"],
    reply: vi.fn().mockResolvedValue({ message_id: 903 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 904 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createDeps(): ExecuteCommandDeps {
  return {
    bot: {} as Bot<Context>,
    ensureEventSubscription: mocked.ensureEventSubscriptionMock,
  };
}

describe("bot/commands/commands", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    foregroundSessionState.__resetForTests();

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Repo",
    };
    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:\\Projects\\Repo",
    };

    mocked.commandListMock.mockReset();
    mocked.sessionStatusMock.mockReset();
    mocked.sessionCreateMock.mockReset();
    mocked.sessionCommandMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.clearSessionMock.mockReset();
    mocked.ingestSessionInfoForCacheMock.mockReset();
    mocked.setSessionSummaryMock.mockReset();
    mocked.setBotAndChatIdMock.mockReset();
    mocked.clearSummaryMock.mockReset();
    mocked.ensureEventSubscriptionMock.mockReset();
    mocked.safeBackgroundTaskMock.mockReset();
    mocked.suppressionRegisterMock.mockReset();

    mocked.sessionStatusMock.mockResolvedValue({
      data: {
        "session-1": {
          type: "idle",
        },
      },
      error: null,
    });
    mocked.sessionCommandMock.mockResolvedValue({ data: {}, error: null });
  });

  it("shows commands list and starts custom interaction", async () => {
    mocked.commandListMock.mockResolvedValue({
      data: [
        { name: "init", description: "create/update AGENTS.md", source: "command" },
        { name: "poem", description: "write a poem", source: "command" },
      ],
      error: null,
    });

    const ctx = createCommandContext(123);
    await commandsCommand(ctx as never);

    expect(mocked.commandListMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("commands:select:0");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("commands:select:1");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("commands:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.flow).toBe("commands");
    expect(state?.metadata.stage).toBe("list");
    expect(state?.metadata.messageId).toBe(123);
  });

  it("transitions to confirmation step after selecting command", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: 321,
        projectDirectory: "D:\\Projects\\Repo",
        commands: [
          { name: "init", description: "create/update AGENTS.md" },
          { name: "poem", description: "write a poem" },
        ],
      },
    });

    const callbackCtx = createCallbackContext("commands:select:1", 321);
    const handled = await handleCommandsCallback(callbackCtx, createDeps());

    expect(handled).toBe(true);

    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      t("commands.confirm", { command: "/poem" }),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("mixed");
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.commandName).toBe("poem");
  });

  it("executes selected command from callback", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "commands",
        stage: "confirm",
        messageId: 400,
        projectDirectory: "D:\\Projects\\Repo",
        commandName: "poem",
      },
    });

    const ctx = createCallbackContext("commands:execute", 400);
    const handled = await handleCommandsCallback(ctx, createDeps());
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith(`${t("commands.executing_prefix")}\n/poem`, {
      entities: [{ type: "code", offset: t("commands.executing_prefix").length + 1, length: 5 }],
    });
    expect(mocked.ensureEventSubscriptionMock).toHaveBeenCalledWith("D:\\Projects\\Repo");
    expect(mocked.setSessionSummaryMock).toHaveBeenCalledWith("session-1");
    expect(mocked.suppressionRegisterMock).toHaveBeenCalledWith("session-1", "/poem");
    expect(mocked.sessionCommandMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
      command: "poem",
      arguments: "",
      agent: "build",
      model: "openai/gpt-5",
      variant: "default",
    });
  });

  it("executes selected command with arguments from text message", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "commands",
        stage: "confirm",
        messageId: 500,
        projectDirectory: "D:\\Projects\\Repo",
        commandName: "poem",
      },
    });

    const ctx = createTextContext("about spring");
    const handled = await handleCommandTextArguments(ctx, createDeps());
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 500);
    expect(ctx.reply).toHaveBeenCalledWith(
      `${t("commands.executing_prefix")}\n/poem about spring`,
      {
        entities: [{ type: "code", offset: t("commands.executing_prefix").length + 1, length: 5 }],
      },
    );
    expect(mocked.suppressionRegisterMock).toHaveBeenCalledWith(
      "session-1",
      "/poem about spring",
    );
    expect(mocked.sessionCommandMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
      command: "poem",
      arguments: "about spring",
      agent: "build",
      model: "openai/gpt-5",
      variant: "default",
    });
  });

  it("handles stale callback as inactive", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        commands: [{ name: "init", description: "create/update AGENTS.md" }],
      },
    });

    const ctx = createCallbackContext("commands:cancel", 999);
    const handled = await handleCommandsCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("commands.inactive_callback"),
      show_alert: true,
    });
    expect(interactionManager.getSnapshot()?.kind).toBe("custom");
  });

  it("shows next-page button when commands exceed page size", async () => {
    const commands = Array.from({ length: 11 }, (_, i) => ({
      name: `cmd${i + 1}`,
      description: `Command ${i + 1} description`,
      source: "command",
    }));

    mocked.commandListMock.mockResolvedValueOnce({
      data: commands,
      error: null,
    });

    const ctx = createCommandContext(700);
    await commandsCommand(ctx as never);

    expect(mocked.commandListMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];

    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("commands:select:0");
    expect(options.reply_markup.inline_keyboard[9]?.[0]?.callback_data).toBe("commands:select:9");

    const paginationRow = options.reply_markup.inline_keyboard[10];
    expect(paginationRow?.[0]?.callback_data).toBe("commands:page:1");
    expect(paginationRow?.[0]?.text).toBe(t("commands.button.next_page"));

    expect(options.reply_markup.inline_keyboard[11]?.[0]?.callback_data).toBe("commands:cancel");
  });

  it("filters out non-command sources from command list", async () => {
    mocked.commandListMock.mockResolvedValue({
      data: [
        { name: "init", description: "create/update AGENTS.md", source: "command" },
        { name: "review", description: "review changes", source: "command" },
        { name: "borsch", description: "Borsch recipe", source: "skill" },
        { name: "from-mcp", description: "MCP prompt", source: "mcp" },
      ],
      error: null,
    });

    const ctx = createCommandContext(750);
    await commandsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];

    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("commands:select:0");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("commands:select:1");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("commands:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.metadata.flow).toBe("commands");
    expect(state?.metadata.stage).toBe("list");
    expect(state?.metadata.commands).toEqual([
      { name: "init", description: "create/update AGENTS.md" },
      { name: "review", description: "review changes" },
    ]);
  });

  it("handles next-page callback and renders second page with prev button", async () => {
    const commands = Array.from({ length: 12 }, (_, i) => ({
      name: `cmd${i + 1}`,
      description: `Command ${i + 1} description`,
    }));

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: 800,
        projectDirectory: "D:\\Projects\\Repo",
        commands,
        page: 0,
      },
    });

    const ctx = createCallbackContext("commands:page:1", 800);
    const handled = await handleCommandsCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];

    expect(text).toBe(t("commands.select_page", { page: 2 }));

    const inlineRows = options.reply_markup.inline_keyboard;
    expect(inlineRows[0]?.[0]?.callback_data).toBe("commands:select:10");
    expect(inlineRows[1]?.[0]?.callback_data).toBe("commands:select:11");

    const paginationRow = inlineRows[2];
    expect(paginationRow?.[0]?.callback_data).toBe("commands:page:0");
    expect(paginationRow?.[0]?.text).toBe(t("commands.button.prev_page"));

    expect(inlineRows[3]?.[0]?.callback_data).toBe("commands:cancel");
  });

  it("returns page-empty callback message when requested page has no commands", async () => {
    const commands = Array.from({ length: 5 }, (_, i) => ({
      name: `cmd${i + 1}`,
      description: `Command ${i + 1} description`,
    }));

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: 900,
        projectDirectory: "D:\\Projects\\Repo",
        commands,
        page: 0,
      },
    });

    const ctx = createCallbackContext("commands:page:5", 900);
    const handled = await handleCommandsCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("commands.page_empty_callback"),
    });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("selects command correctly after pagination", async () => {
    const commands = Array.from({ length: 15 }, (_, i) => ({
      name: `cmd${i + 1}`,
      description: `Command ${i + 1} description`,
    }));

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "commands",
        stage: "list",
        messageId: 1000,
        projectDirectory: "D:\\Projects\\Repo",
        commands,
        page: 1,
      },
    });

    const ctx = createCallbackContext("commands:select:12", 1000);
    const handled = await handleCommandsCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      t("commands.confirm", { command: "/cmd13" }),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.commandName).toBe("cmd13");
  });
});

describe("commands pagination helpers", () => {
  describe("parseCommandPageCallback", () => {
    it("parses valid page callbacks", () => {
      expect(parseCommandPageCallback("commands:page:0")).toBe(0);
      expect(parseCommandPageCallback("commands:page:12")).toBe(12);
      expect(parseCommandPageCallback("commands:page:99")).toBe(99);
    });

    it("returns null for non-page callbacks", () => {
      expect(parseCommandPageCallback("commands:select:0")).toBeNull();
      expect(parseCommandPageCallback("commands:page:-1")).toBeNull();
      expect(parseCommandPageCallback("commands:page:abc")).toBeNull();
      expect(parseCommandPageCallback("commands:cancel")).toBeNull();
      expect(parseCommandPageCallback("session:page:1")).toBeNull();
    });
  });

  describe("formatCommandsSelectText", () => {
    it("returns base text for first page", () => {
      expect(formatCommandsSelectText(0)).toBe("Choose an OpenCode command:");
    });

    it("returns page-specific text for subsequent pages", () => {
      expect(formatCommandsSelectText(1)).toBe("Choose an OpenCode command (page 2):");
      expect(formatCommandsSelectText(5)).toBe("Choose an OpenCode command (page 6):");
    });
  });

  describe("calculateCommandsPaginationRange", () => {
    it("returns first page bounds", () => {
      expect(calculateCommandsPaginationRange(25, 0, 10)).toEqual({
        page: 0,
        totalPages: 3,
        startIndex: 0,
        endIndex: 10,
      });
    });

    it("returns correct bounds for middle page", () => {
      expect(calculateCommandsPaginationRange(25, 1, 10)).toEqual({
        page: 1,
        totalPages: 3,
        startIndex: 10,
        endIndex: 20,
      });
    });

    it("returns correct bounds for last page", () => {
      expect(calculateCommandsPaginationRange(25, 2, 10)).toEqual({
        page: 2,
        totalPages: 3,
        startIndex: 20,
        endIndex: 25,
      });
    });

    it("clamps page to valid range", () => {
      expect(calculateCommandsPaginationRange(25, 99, 10)).toEqual({
        page: 2,
        totalPages: 3,
        startIndex: 20,
        endIndex: 25,
      });

      expect(calculateCommandsPaginationRange(25, -5, 10)).toEqual({
        page: 0,
        totalPages: 3,
        startIndex: 0,
        endIndex: 10,
      });
    });

    it("handles empty list", () => {
      expect(calculateCommandsPaginationRange(0, 0, 10)).toEqual({
        page: 0,
        totalPages: 1,
        startIndex: 0,
        endIndex: 0,
      });
    });

    it("handles single page", () => {
      expect(calculateCommandsPaginationRange(5, 0, 10)).toEqual({
        page: 0,
        totalPages: 1,
        startIndex: 0,
        endIndex: 5,
      });
    });

    it("uses provided pageSize correctly", () => {
      expect(calculateCommandsPaginationRange(15, 0, 5)).toEqual({
        page: 0,
        totalPages: 3,
        startIndex: 0,
        endIndex: 5,
      });

      expect(calculateCommandsPaginationRange(15, 1, 5)).toEqual({
        page: 1,
        totalPages: 3,
        startIndex: 5,
        endIndex: 10,
      });
    });
  });
});
