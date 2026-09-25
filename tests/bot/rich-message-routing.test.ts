import { beforeEach, describe, expect, it, vi } from "vitest";
import { Bot, type Context } from "grammy";
import type { RichBlock, Update, UserFromGetMe } from "grammy/types";
import { config } from "../../src/config.js";
import { t } from "../../src/i18n/index.js";
import { promptQueue } from "../../src/app/managers/prompt-queue-manager.js";
import type { AppContainer } from "../../src/app/bootstrap/app-container.js";

const mocked = vi.hoisted(() => ({
  queuePromptForMerging: vi.fn(),
  handleQuestionTextAnswer: vi.fn(),
  handleTaskTextInput: vi.fn(),
  handleModelSearchTextInput: vi.fn(),
  handleRenameTextAnswer: vi.fn(),
  handleCatalogTextArguments: vi.fn(),
  statusCommand: vi.fn(),
  getPromptQueueMode: vi.fn(),
}));

vi.mock("../../src/bot/handlers/message-merger.js", () => ({
  queuePromptForMerging: mocked.queuePromptForMerging,
  flushPendingPrompt: vi.fn(),
  __resetMessageMergerForTests: vi.fn(),
}));

vi.mock("../../src/bot/callbacks/question-callback-handler.js", () => ({
  handleQuestionTextAnswer: mocked.handleQuestionTextAnswer,
}));

vi.mock("../../src/bot/commands/task-command.js", () => ({
  handleTaskTextInput: mocked.handleTaskTextInput,
  taskCommand: vi.fn(),
}));

vi.mock("../../src/bot/callbacks/model-selection-callback-handler.js", () => ({
  handleModelSearchTextInput: mocked.handleModelSearchTextInput,
}));

vi.mock("../../src/bot/callbacks/rename-callback-handler.js", () => ({
  handleRenameTextAnswer: mocked.handleRenameTextAnswer,
}));

vi.mock("../../src/bot/handlers/text-message-handler.js", () => ({
  handleCatalogTextArguments: mocked.handleCatalogTextArguments,
}));

vi.mock("../../src/bot/commands/status-command.js", () => ({
  statusCommand: mocked.statusCommand,
}));

vi.mock("../../src/app/stores/settings-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/stores/settings-store.js")>();
  return {
    ...actual,
    getPromptQueueMode: mocked.getPromptQueueMode,
  };
});

import { initializePromptQueueDispatch } from "../../src/bot/handlers/prompt-queue-dispatch.js";
import { normalizeRichMessage } from "../../src/bot/handlers/rich-message-handler.js";
import { interactionGuardMiddleware } from "../../src/bot/middleware/interaction-guard.js";
import { registerCommandRouter } from "../../src/bot/routers/command-router.js";
import { registerMessageRouter } from "../../src/bot/routers/message-router.js";
import { createTestAppContainer } from "../helpers/app-container.js";

const BOT_INFO: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: "Test",
  username: "test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

interface RoutingBot {
  bot: Bot<Context>;
  replies: string[];
}

function createRoutingBot(): RoutingBot {
  const replies: string[] = [];
  const bot = new Bot<Context>("test-token", {
    botInfo: BOT_INFO,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    if (method === "sendMessage" && payload && typeof payload === "object" && "text" in payload) {
      replies.push(String(payload.text));
    }
    const stubResponse = { ok: true as const, result: { message_id: 1 } };
    return stubResponse as never;
  });
  bot.on("message:rich_message", normalizeRichMessage);
  const routedContainer: AppContainer = {
    ...container,
    ensureEventSubscription: vi.fn(),
    setTelegramContext: vi.fn(),
    resetRuntimeStreams: vi.fn(),
  };
  initializePromptQueueDispatch({ ...routedContainer, bot });
  bot.use((ctx, next) => interactionGuardMiddleware(ctx, next, routedContainer));
  registerCommandRouter(bot, { container: routedContainer });
  registerMessageRouter(bot, { container: routedContainer });
  return { bot, replies };
}

function richUpdate(blocks: RichBlock[]): Update {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: 1,
      chat: { id: config.telegram.allowedUserId, type: "private" as const },
      from: {
        id: config.telegram.allowedUserId,
        is_bot: false,
        first_name: "User",
      },
      rich_message: { blocks },
    },
  } as Update;
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/rich-message-routing", () => {
  beforeEach(() => {
    mocked.queuePromptForMerging.mockReset();
    mocked.handleQuestionTextAnswer.mockReset().mockResolvedValue(undefined);
    mocked.handleTaskTextInput.mockReset().mockResolvedValue(false);
    mocked.handleModelSearchTextInput.mockReset().mockResolvedValue(false);
    mocked.handleRenameTextAnswer.mockReset().mockResolvedValue(false);
    mocked.handleCatalogTextArguments.mockReset().mockResolvedValue(false);
    mocked.statusCommand.mockReset().mockResolvedValue(undefined);
    mocked.getPromptQueueMode.mockReset().mockReturnValue("off");
    promptQueue.__resetForTests();
  });

  it("routes a converted rich sentence as an ordinary prompt", async () => {
    const { bot } = createRoutingBot();

    await bot.handleUpdate(
      richUpdate([{ type: "paragraph", text: "How are you feeling today?" }]),
    );

    expect(mocked.queuePromptForMerging).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ text: "How are you feeling today?" }),
      }),
      expect.objectContaining({
        text: "How are you feeling today?",
        photos: [],
      }),
      expect.anything(),
      expect.any(Number),
    );
  });

  it("routes a slash-prefixed rich message as a known command", async () => {
    const { bot } = createRoutingBot();

    await bot.handleUpdate(richUpdate([{ type: "paragraph", text: "/status" }]));

    expect(mocked.statusCommand).toHaveBeenCalledOnce();
    expect(mocked.queuePromptForMerging).not.toHaveBeenCalled();
  });

  it("answers an unknown slash-prefixed rich message", async () => {
    const { bot, replies } = createRoutingBot();

    await bot.handleUpdate(richUpdate([{ type: "paragraph", text: "/not-a-command" }]));

    expect(replies).toContain(t("bot.unknown_command", { command: "/not-a-command" }));
    expect(mocked.queuePromptForMerging).not.toHaveBeenCalled();
  });

  it("keeps an active question from falling through to a prompt", async () => {
    container.questionManager.startQuestions(
      [{ header: "Q", question: "?", options: [] }],
      "req-1",
    );
    // A text answer is accepted once the user picked "custom answer".
    container.interactionManager.transition({ expectedInput: "mixed" });
    const { bot } = createRoutingBot();

    await bot.handleUpdate(richUpdate([{ type: "paragraph", text: "an answer" }]));

    expect(mocked.handleQuestionTextAnswer).toHaveBeenCalledOnce();
    expect(mocked.queuePromptForMerging).not.toHaveBeenCalled();
  });

  it("sends empty rich input to rename instead of OpenCode", async () => {
    mocked.handleRenameTextAnswer.mockResolvedValue(true);
    const { bot } = createRoutingBot();

    await bot.handleUpdate(richUpdate([]));

    expect(mocked.handleRenameTextAnswer).toHaveBeenCalledOnce();
    const ctx = mocked.handleRenameTextAnswer.mock.calls[0]?.[0] as Context;
    expect(ctx.message?.text).toBe("");
    expect(mocked.queuePromptForMerging).not.toHaveBeenCalled();
  });

  it("sends empty rich input through task and catalog argument handlers", async () => {
    mocked.handleTaskTextInput.mockResolvedValueOnce(true);
    const { bot } = createRoutingBot();
    await bot.handleUpdate(richUpdate([]));
    expect(mocked.handleTaskTextInput).toHaveBeenCalledOnce();

    mocked.handleTaskTextInput.mockResolvedValueOnce(false);
    mocked.handleCatalogTextArguments.mockResolvedValueOnce(true);
    await bot.handleUpdate(richUpdate([]));
    expect(mocked.handleCatalogTextArguments).toHaveBeenCalledOnce();
    expect(mocked.queuePromptForMerging).not.toHaveBeenCalled();
  });

  it("sends a photo-only rich prompt through merging without downloading", async () => {
    const { bot } = createRoutingBot();

    await bot.handleUpdate(
      richUpdate([
        {
          type: "photo",
          photo: [
            {
              file_id: "photo-1",
              file_unique_id: "p",
              width: 100,
              height: 100,
              file_size: 512,
            },
          ],
        },
      ]),
    );

    expect(mocked.queuePromptForMerging).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        text: "",
        photos: [expect.objectContaining({ fileId: "photo-1", source: "rich" })],
      }),
      expect.anything(),
      expect.any(Number),
    );
  });

  it("queues a photo-only rich prompt while busy without downloading", async () => {
    mocked.getPromptQueueMode.mockReturnValue("queue");
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    const { bot } = createRoutingBot();

    await bot.handleUpdate(
      richUpdate([
        {
          type: "photo",
          photo: [
            {
              file_id: "photo-1",
              file_unique_id: "p",
              width: 100,
              height: 100,
              file_size: 512,
            },
          ],
        },
      ]),
    );

    expect(promptQueue.list()).toEqual([
      expect.objectContaining({
        text: "",
        photos: [expect.objectContaining({ fileId: "photo-1", source: "rich" })],
        mediaBytes: 512,
      }),
    ]);
    expect(mocked.queuePromptForMerging).not.toHaveBeenCalled();
  });

  it("refuses a rich prompt when the queue is disabled", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    const { bot, replies } = createRoutingBot();

    await bot.handleUpdate(richUpdate([{ type: "paragraph", text: "later" }]));

    expect(promptQueue.size()).toBe(0);
    expect(mocked.queuePromptForMerging).not.toHaveBeenCalled();
    expect(replies.some((text) => text.includes(t("bot.session_busy")))).toBe(true);
  });
});
