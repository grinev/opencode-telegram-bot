import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import { commandsCommand } from "../../../src/bot/commands/command-catalog-command.js";
import {
  handleCommandsCallback,
  handleCommandsSearchTextInput,
  type ExecuteCommandDeps,
} from "../../../src/bot/callbacks/command-catalog-callback-handler.js";
import { handleCommandTextArguments } from "../../../src/bot/handlers/text-message-handler.js";
import {
  calculateCommandsPaginationRange,
  formatCommandsSelectText,
  parseCommandPageCallback,
  filterCommandsForSearch,
} from "../../../src/bot/menus/command-catalog-menu.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";
import { logger } from "../../../src/utils/logger.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import { startInteractionForTest } from "../../helpers/interaction.js";

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
  attachToSessionMock: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
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

vi.mock("../../../src/app/services/session-cache-service.js", () => ({
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

vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
  resolveProjectAgent: vi.fn(async (agentName?: string) => agentName ?? "build"),
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: vi.fn(() => ({
    providerID: "openai",
    modelID: "gpt-5",
    variant: "default",
  })),
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: vi.fn((options) => {
    mocked.safeBackgroundTaskMock(options);
  }),
}));

vi.mock("../../../src/app/services/attach-service.js", () => ({
  attachToSession: mocked.attachToSessionMock,
  detachAttachedSession: vi.fn(),
  markAttachedSessionBusy: vi.fn().mockResolvedValue(undefined),
  markAttachedSessionIdle: vi.fn().mockResolvedValue(undefined),
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
    ...container,
    ensureEventSubscription: mocked.ensureEventSubscriptionMock,
    summaryAggregator: {
      setSession: mocked.setSessionSummaryMock,
      setBotAndChatId: mocked.setBotAndChatIdMock,
      clear: mocked.clearSummaryMock,
    } as never,
    externalUserInputSuppressionManager: {
      register: mocked.suppressionRegisterMock,
    } as never,
    bot: {} as Bot<Context>,
  };
}

function getScheduledBackgroundTask(): {
  task: () => Promise<unknown>;
  onSuccess?: (value: { error: unknown | null }) => void;
  onError?: (error: unknown) => void;
} {
  const [[options]] = mocked.safeBackgroundTaskMock.mock.calls as [
    [
      {
        task: () => Promise<unknown>;
        onSuccess?: (value: { error: unknown | null }) => void;
        onError?: (error: unknown) => void;
      },
    ],
  ];

  return options;
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/commands/commands", () => {
  beforeEach(() => {
    container.interactionManager.clear("test_setup");
    container.attachManager.attach("session-1", "D:\\Projects\\Repo");

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
    mocked.attachToSessionMock.mockReset();
    mocked.attachToSessionMock.mockResolvedValue({
      busy: false,
      alreadyAttached: false,
      restoredQuestion: false,
      restoredPermissions: 0,
    });

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
    await commandsCommand(ctx as never, createDeps());

    expect(mocked.commandListMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = defined((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]) as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("commands:search");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("commands:select:0");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("commands:select:1");
    expect(options.reply_markup.inline_keyboard[3]?.[0]?.callback_data).toBe("commands:cancel");

    const state = container.interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.flow).toBe("commands");
    expect(state?.metadata.stage).toBe("list");
    expect(state?.metadata.messageId).toBe(123);
  });

  it("transitions to confirmation step after selecting command", async () => {
    container.interactionManager.start({
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

    const state = container.interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("mixed");
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.commandName).toBe("poem");
  });

  it("executes selected command from callback", async () => {
    container.interactionManager.start({
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
    const backgroundTask = getScheduledBackgroundTask();
    await backgroundTask.task();

    expect(handled).toBe(true);
    expect(container.interactionManager.getSnapshot()).toBeNull();
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith(`${t("commands.executing_prefix")}\n/poem`, {
      entities: [{ type: "code", offset: t("commands.executing_prefix").length + 1, length: 5 }],
    });
    expect(mocked.attachToSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bot: expect.any(Object),
        chatId: 777,
        session: {
          id: "session-1",
          title: "Session",
          directory: "D:\\Projects\\Repo",
        },
        ensureEventSubscription: mocked.ensureEventSubscriptionMock,
      }),
    );
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

  it("names a session it had to create as a new session while OpenCode has not named it", async () => {
    mocked.currentSession = null;
    mocked.sessionCreateMock.mockResolvedValueOnce({
      data: { id: "session-2", title: "" },
      error: null,
    });
    container.interactionManager.start({
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
    await handleCommandsCallback(ctx, createDeps());

    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-2",
      title: "",
      directory: "D:\\Projects\\Repo",
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      t("bot.session_created", { title: t("pinned.default_session_title") }),
    );
  });

  it("executes selected command with arguments from text message", async () => {
    container.interactionManager.start({
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
    const backgroundTask = getScheduledBackgroundTask();
    await backgroundTask.task();

    expect(handled).toBe(true);
    expect(container.interactionManager.getSnapshot()).toBeNull();
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

  it("notifies the user when session.command reports an error while attached", async () => {
    container.interactionManager.start({
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
    const backgroundTask = getScheduledBackgroundTask();
    backgroundTask.onSuccess?.({ error: new Error("command failed") });

    expect(handled).toBe(true);
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(777, t("commands.execute_error"));
  });

  it("notifies the user when session.command rejects while attached", async () => {
    container.interactionManager.start({
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
    const backgroundTask = getScheduledBackgroundTask();
    const startError = new Error("network down");
    mocked.sessionCommandMock.mockRejectedValueOnce(startError);

    await backgroundTask.task().catch((error) => {
      backgroundTask.onError?.(error);
    });

    expect(handled).toBe(true);
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(777, t("commands.execute_error"));
  });

  it("does not notify the user when session.command reports an error after detach", async () => {
    container.interactionManager.start({
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
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const handled = await handleCommandsCallback(ctx, createDeps());

    container.attachManager.clear("test_detach");

    const backgroundTask = getScheduledBackgroundTask();
    backgroundTask.onSuccess?.({ error: new Error("command failed") });

    expect(handled).toBe(true);
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not notify the user when session.command rejects after detach", async () => {
    container.interactionManager.start({
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
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const handled = await handleCommandsCallback(ctx, createDeps());

    container.attachManager.clear("test_detach");

    const backgroundTask = getScheduledBackgroundTask();
    const startError = new Error("network down");
    mocked.sessionCommandMock.mockRejectedValueOnce(startError);

    await backgroundTask.task().catch((error) => {
      backgroundTask.onError?.(error);
    });

    expect(handled).toBe(true);
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not notify the user when session.command fails while attached to another session", async () => {
    container.interactionManager.start({
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

    container.attachManager.attach("session-2", "D:\\Projects\\Repo");

    const backgroundTask = getScheduledBackgroundTask();
    backgroundTask.onSuccess?.({ error: new Error("command failed") });

    expect(handled).toBe(true);
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });

  it("still notifies the user when session.command fails after re-attach to the same session", async () => {
    container.interactionManager.start({
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

    container.attachManager.clear("test_detach");
    container.attachManager.attach("session-1", "D:\\Projects\\Repo");

    const backgroundTask = getScheduledBackgroundTask();
    backgroundTask.onSuccess?.({ error: new Error("command failed") });

    expect(handled).toBe(true);
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(777, t("commands.execute_error"));
  });

  it("handles stale callback as inactive", async () => {
    container.interactionManager.start({
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
    expect(container.interactionManager.getSnapshot()?.kind).toBe("custom");
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
    await commandsCommand(ctx as never, createDeps());

    expect(mocked.commandListMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });

    const [, options] = defined((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]) as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];

    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("commands:search");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("commands:select:0");
    expect(options.reply_markup.inline_keyboard[10]?.[0]?.callback_data).toBe("commands:select:9");

    const paginationRow = options.reply_markup.inline_keyboard[11];
    expect(paginationRow?.[0]?.callback_data).toBe("commands:page:1");
    expect(paginationRow?.[0]?.text).toBe(t("commands.button.next_page"));

    expect(options.reply_markup.inline_keyboard[12]?.[0]?.callback_data).toBe("commands:cancel");
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
    await commandsCommand(ctx as never, createDeps());

    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = defined((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]) as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];

    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("commands:search");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("commands:select:0");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("commands:select:1");
    expect(options.reply_markup.inline_keyboard[3]?.[0]?.callback_data).toBe("commands:cancel");

    const state = container.interactionManager.getSnapshot();
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

    container.interactionManager.start({
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

    const [text, options] = defined((ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0]) as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];

    expect(text).toBe(t("commands.select_page", { page: 2 }));

    const inlineRows = options.reply_markup.inline_keyboard;
    expect(inlineRows[0]?.[0]?.callback_data).toBe("commands:search");
    expect(inlineRows[1]?.[0]?.callback_data).toBe("commands:select:10");
    expect(inlineRows[2]?.[0]?.callback_data).toBe("commands:select:11");

    const paginationRow = inlineRows[3];
    expect(paginationRow?.[0]?.callback_data).toBe("commands:page:0");
    expect(paginationRow?.[0]?.text).toBe(t("commands.button.prev_page"));

    expect(inlineRows[4]?.[0]?.callback_data).toBe("commands:cancel");
  });

  it("returns page-empty callback message when requested page has no commands", async () => {
    const commands = Array.from({ length: 5 }, (_, i) => ({
      name: `cmd${i + 1}`,
      description: `Command ${i + 1} description`,
    }));

    container.interactionManager.start({
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

    container.interactionManager.start({
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

    const state = container.interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.commandName).toBe("cmd13");
  });
  describe("search", () => {
    const catalog = Array.from({ length: 12 }, (_, index) => ({
      name: `command-${index}`,
      description: `Description ${index}`,
      source: "command",
    }));

    beforeEach(() => {
      mocked.commandListMock.mockResolvedValue({ data: catalog, error: null });
    });

    async function openSearch() {
      await commandsCommand(createCommandContext(100) as never, createDeps());
      const ctx = createCallbackContext("commands:search", 100);
      await handleCommandsCallback(ctx, createDeps());
      return ctx;
    }

    async function showResults(query = "command") {
      await openSearch();
      const ctx = createTextContext(query);
      await handleCommandsSearchTextInput(ctx, createDeps());
      return ctx;
    }

    it("deletes the list and waits for a query without allowed utility commands", async () => {
      const ctx = await openSearch();
      expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
      expect(ctx.reply).toHaveBeenCalledWith(t("commands.search.prompt"));
      expect(container.interactionManager.getSnapshot()).toMatchObject({
        kind: "custom",
        expectedInput: "text",
        allowedCommands: [],
        metadata: { flow: "commands-search", stage: "input" },
      });
    });

    it("searches the fresh catalog by full fields while preserving query text and catalog order", async () => {
      await openSearch();
      mocked.commandListMock.mockResolvedValueOnce({
        data: [
          { name: "first", description: `${"x".repeat(90)} Needle`, source: "command" },
          { name: "NEEDLE", source: "command" },
          { name: "other", description: "not a match", source: "command" },
          { name: "needle-skill", source: "skill" },
          { name: "goal", description: "needle", source: "command" },
        ],
        error: null,
      });
      const ctx = createTextContext("  nEeDlE  ");
      expect(await handleCommandsSearchTextInput(ctx, createDeps())).toBe(true);
      expect(mocked.commandListMock).toHaveBeenCalledTimes(2);
      expect(ctx.reply).toHaveBeenCalledWith(
        t("commands.search.results", { query: "  nEeDlE  " }),
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
      expect(container.interactionManager.getSnapshot()).toMatchObject({
        expectedInput: "callback",
        allowedCommands: [],
        metadata: {
          stage: "results",
          query: "  nEeDlE  ",
          commands: [{ name: "first" }, { name: "NEEDLE" }],
          messageId: 903,
        },
      });
      expect(mocked.sessionCommandMock).not.toHaveBeenCalled();
    });

    it("reloads and paginates all matches with the existing page size", async () => {
      await showResults();
      const ctx = createCallbackContext("commands:search:page:1", 903);
      const updated = [...catalog, { name: "command-new", description: "new", source: "command" }];
      mocked.commandListMock.mockResolvedValueOnce({ data: updated, error: null });
      await handleCommandsCallback(ctx, createDeps());
      const [text, options] = vi.mocked(ctx.editMessageText).mock.calls[0]!;
      expect(text).toBe(t("commands.search.results_page", { query: "command", page: 2 }));
      expect(options?.reply_markup?.inline_keyboard).toEqual([
        [expect.objectContaining({ callback_data: "commands:search:result:10" })],
        [expect.objectContaining({ callback_data: "commands:search:result:11" })],
        [expect.objectContaining({ callback_data: "commands:search:result:12" })],
        [expect.objectContaining({ callback_data: "commands:search:page:0" })],
        [
          { text: t("commands.search.again"), callback_data: "commands:search:again" },
          { text: t("commands.search.cancel"), callback_data: "commands:search:cancel" },
        ],
      ]);
      expect(mocked.commandListMock).toHaveBeenCalledTimes(3);
      expect(container.interactionManager.getSnapshot()?.metadata.commands).toHaveLength(13);
    });

    it("shows no results with only search again and cancel", async () => {
      const ctx = await showResults("absent");
      const [text, options] = vi.mocked(ctx.reply).mock.calls[0]!;
      expect(text).toBe(t("commands.search.no_results", { query: "absent" }));
      expect(options?.reply_markup).toMatchObject({
        inline_keyboard: [
          [
            { text: t("commands.search.again"), callback_data: "commands:search:again" },
            { text: t("commands.search.cancel"), callback_data: "commands:search:cancel" },
          ],
        ],
      });
    });

    it("silently waits on whitespace and caps the query including the heading at 100 characters", async () => {
      await openSearch();
      const whitespace = createTextContext("   ");
      const before = container.interactionManager.getSnapshot();
      await handleCommandsSearchTextInput(whitespace, createDeps());
      expect(whitespace.reply).not.toHaveBeenCalled();
      expect(container.interactionManager.getSnapshot()).toEqual(before);
      expect(mocked.commandListMock).toHaveBeenCalledTimes(1);
      const ctx = createTextContext("a".repeat(110));
      await handleCommandsSearchTextInput(ctx, createDeps());
      expect(ctx.reply).toHaveBeenCalledWith(
        t("commands.search.no_results", { query: "a".repeat(100) }),
        expect.anything(),
      );
      expect(container.interactionManager.getSnapshot()?.metadata.query).toHaveLength(100);
    });

    it("starts a new query after deleting results and makes their buttons inactive", async () => {
      await showResults();
      const token = container.interactionManager.getSnapshot()?.metadata.token;
      const ctx = createCallbackContext("commands:search:again", 903);
      await handleCommandsCallback(ctx, createDeps());
      expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
      expect(ctx.reply).toHaveBeenCalledWith(t("commands.search.prompt"));
      expect(container.interactionManager.getSnapshot()?.metadata.stage).toBe("input");
      expect(container.interactionManager.getSnapshot()?.metadata.token).not.toBe(token);
      const stale = createCallbackContext("commands:search:result:0", 903);
      await handleCommandsCallback(stale, createDeps());
      expect(stale.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("inline.inactive_callback"),
        show_alert: true,
      });
    });

    it("cancels without reopening the list", async () => {
      await showResults();
      const ctx = createCallbackContext("commands:search:cancel", 903);
      await handleCommandsCallback(ctx, createDeps());
      expect(container.interactionManager.getSnapshot()).toBeNull();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("common.cancelled") });
      expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it("selects a result into the unchanged confirmation and accepts command arguments", async () => {
      await showResults();
      const ctx = createCallbackContext("commands:search:result:11", 903);
      await handleCommandsCallback(ctx, createDeps());
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        t("commands.confirm", { command: "/command-11" }),
        expect.anything(),
      );
      expect(ctx.deleteMessage).not.toHaveBeenCalled();
      expect(mocked.sessionCommandMock).not.toHaveBeenCalled();
      expect(container.interactionManager.getSnapshot()).toMatchObject({
        expectedInput: "mixed",
        allowedCommands: expect.arrayContaining(["/help", "/status", "/abort"]),
        metadata: { flow: "commands", stage: "confirm", commandName: "command-11", messageId: 903 },
      });
      await handleCommandTextArguments(createTextContext("some arguments"), createDeps());
      await getScheduledBackgroundTask().task();
      expect(mocked.sessionCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "command-11",
          arguments: "some arguments",
        }),
      );
    });

    it("clears the search on a catalog error after query entry", async () => {
      await openSearch();
      mocked.commandListMock.mockRejectedValueOnce(new Error("offline"));
      const ctx = createTextContext("command");
      await handleCommandsSearchTextInput(ctx, createDeps());
      expect(ctx.reply).toHaveBeenCalledWith(t("commands.fetch_error"));
      expect(container.interactionManager.getSnapshot()).toBeNull();
      expect(ctx.deleteMessage).not.toHaveBeenCalled();
    });

    it("keeps results available when loading another page fails", async () => {
      await showResults();
      const before = container.interactionManager.getSnapshot();
      mocked.commandListMock.mockRejectedValueOnce(new Error("offline"));
      const ctx = createCallbackContext("commands:search:page:1", 903);
      await handleCommandsCallback(ctx, createDeps());
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("commands.page_load_error_callback"),
      });
      expect(ctx.editMessageText).not.toHaveBeenCalled();
      expect(container.interactionManager.getSnapshot()).toEqual(before);
    });

    it.each(["question", "permission"] as const)(
      "does not resume after a %s replaces results",
      async (kind) => {
        await showResults();
        startInteractionForTest(container.interactionManager, { kind, expectedInput: "callback" });
        const before = container.interactionManager.getSnapshot();
        const ctx = createCallbackContext("commands:search:result:0", 903);
        await handleCommandsCallback(ctx, createDeps());
        expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
          text: t("inline.inactive_callback"),
          show_alert: true,
        });
        expect(ctx.editMessageText).not.toHaveBeenCalled();
        expect(ctx.deleteMessage).not.toHaveBeenCalled();
        expect(container.interactionManager.getSnapshot()).toEqual(before);
        container.interactionManager.clear("agent_request_ended");
        expect(
          await handleCommandsSearchTextInput(createTextContext("command"), createDeps()),
        ).toBe(false);
      },
    );

    it.each([
      "load",
      "send",
      "page load",
      "page edit",
      "selection edit",
      "start delete",
      "again delete",
    ])("does not overwrite a replacement interaction during %s", async (boundary) => {
      const replace = () =>
        startInteractionForTest(container.interactionManager, {
          kind: "permission",
          expectedInput: "callback",
        });
      if (boundary === "start delete") {
        await commandsCommand(createCommandContext(100) as never, createDeps());
        const ctx = createCallbackContext("commands:search", 100);
        vi.mocked(ctx.deleteMessage).mockImplementationOnce(async () => {
          replace();
          return true;
        });
        await handleCommandsCallback(ctx, createDeps());
        expect(ctx.reply).not.toHaveBeenCalled();
      } else if (boundary === "load" || boundary === "send") {
        await openSearch();
        const ctx = createTextContext("command");
        if (boundary === "load") {
          mocked.commandListMock.mockImplementationOnce(async () => {
            replace();
            return { data: catalog, error: null };
          });
        } else {
          vi.mocked(ctx.reply).mockImplementationOnce(async () => {
            replace();
            return { message_id: 903 } as never;
          });
        }
        await handleCommandsSearchTextInput(ctx, createDeps());
        if (boundary === "load") expect(ctx.reply).not.toHaveBeenCalled();
      } else {
        await showResults();
        const data =
          boundary === "selection edit"
            ? "result:0"
            : boundary === "again delete"
              ? "again"
              : "page:1";
        const ctx = createCallbackContext(`commands:search:${data}`, 903);
        if (boundary === "page load") {
          mocked.commandListMock.mockImplementationOnce(async () => {
            replace();
            return { data: catalog, error: null };
          });
        } else if (boundary === "again delete") {
          vi.mocked(ctx.deleteMessage).mockImplementationOnce(async () => {
            replace();
            return true;
          });
        } else {
          vi.mocked(ctx.editMessageText).mockImplementationOnce(async () => {
            replace();
            return true as never;
          });
        }
        await handleCommandsCallback(ctx, createDeps());
        if (boundary === "page load") expect(ctx.editMessageText).not.toHaveBeenCalled();
      }
      expect(container.interactionManager.getSnapshot()?.kind).toBe("permission");
    });

    it.each(["search", "search:page:1", "search:result:0", "search:again", "search:cancel"])(
      "blocks commands:%s while busy without changing the search",
      async (suffix) => {
        await showResults();
        container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
        const before = container.interactionManager.getSnapshot();
        const ctx = createCallbackContext(`commands:${suffix}`, 903);
        await handleCommandsCallback(ctx, createDeps());
        expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("bot.session_busy") });
        expect(ctx.editMessageText).not.toHaveBeenCalled();
        expect(ctx.deleteMessage).not.toHaveBeenCalled();
        expect(container.interactionManager.getSnapshot()).toEqual(before);
      },
    );

    it.each(["question", "permission"] as const)(
      "preserves a replacement %s when Telegram rejects the result selection edit",
      async (kind) => {
        await showResults();
        const ctx = createCallbackContext("commands:search:result:0", 903);
        vi.mocked(ctx.editMessageText).mockImplementationOnce(async () => {
          startInteractionForTest(container.interactionManager, { kind, expectedInput: "callback" });
          throw new Error("Telegram edit failed");
        });
        await expect(handleCommandsCallback(ctx, createDeps())).resolves.toBe(true);
        expect(container.interactionManager.getSnapshot()?.kind).toBe(kind);
        expect(ctx.deleteMessage).not.toHaveBeenCalled();
        expect(mocked.sessionCommandMock).not.toHaveBeenCalled();
      },
    );

    it("handles a rejected result selection edit locally when the search still owns the slot", async () => {
      await showResults();
      const ctx = createCallbackContext("commands:search:result:0", 903);
      vi.mocked(ctx.editMessageText).mockRejectedValueOnce(new Error("Telegram edit failed"));
      await expect(handleCommandsCallback(ctx, createDeps())).resolves.toBe(true);
      expect(container.interactionManager.getSnapshot()).toBeNull();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("callback.processing_error") });
      expect(mocked.sessionCommandMock).not.toHaveBeenCalled();
    });

    it("refuses /commands while busy without opening or loading the list", async () => {
      container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
      const ctx = createCommandContext(100);
      await commandsCommand(ctx as never, createDeps());
      expect(ctx.reply).toHaveBeenCalledWith(t("bot.session_busy"));
      expect(mocked.commandListMock).not.toHaveBeenCalled();
      expect(container.interactionManager.getSnapshot()).toBeNull();
    });

    it.each(["no project", "empty catalog", "catalog error"])(
      "keeps the initial notice without Search for %s",
      async (reason) => {
        if (reason === "no project") mocked.currentProject = null;
        if (reason === "empty catalog")
          mocked.commandListMock.mockResolvedValueOnce({ data: [], error: null });
        if (reason === "catalog error")
          mocked.commandListMock.mockRejectedValueOnce(new Error("offline"));
        const ctx = createCommandContext(100);
        await commandsCommand(ctx as never, createDeps());
        const key =
          reason === "no project"
            ? "bot.project_not_selected"
            : reason === "empty catalog"
              ? "commands.empty"
              : "commands.fetch_error";
        expect(ctx.reply).toHaveBeenCalledWith(t(key));
        expect(container.interactionManager.getSnapshot()).toBeNull();
      },
    );
  });
});

describe("commands search matching", () => {
  it("does not search the no-description placeholder", () => {
    expect(filterCommandsForSearch([{ name: "init" }], t("commands.no_description"))).toEqual([]);
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
