import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer, Context, type Api, type NextFunction } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { telegramInputOrderManager, telegramInputOrderMiddleware } from "../../../src/app/managers/telegram-input-order-manager.js";
import { createMediaGroupAttachmentMiddleware } from "../../../src/bot/handlers/media-group-handler.js";
import * as sessionService from "../../../src/app/services/session-service.js";
import * as settingsStore from "../../../src/app/stores/settings-store.js";

const BOT_INFO = {
  id: 999,
  is_bot: true,
  first_name: "test",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
} satisfies UserFromGetMe;

const MODEL_CAPABILITIES = {
  temperature: true,
  reasoning: true,
  attachment: true,
  toolcall: true,
  input: { text: true, audio: false, image: true, video: false, pdf: true },
  output: { text: true, audio: false, image: false, video: false, pdf: false },
  interleaved: false,
};

function messageUpdate(updateId: number, message: Record<string, unknown>): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      chat: { id: 777, type: "private", first_name: "User" },
      from: { id: 1, is_bot: false, first_name: "User" },
      ...message,
    },
  } as Update;
}

describe("bot/routers Telegram album ordering", () => {
  beforeEach(() => {
    telegramInputOrderManager.__resetForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    telegramInputOrderManager.__resetForTests();
  });

  it("submits an album under captured session A before /new and every later media route", async () => {
    let currentSession = { id: "session-a", title: "A", directory: "/repo-a" };
    const currentProject = { id: "project-a", worktree: "/repo-a" };
    vi.spyOn(sessionService, "getCurrentSession").mockImplementation(() => currentSession);
    vi.spyOn(settingsStore, "getCurrentProject").mockImplementation(() => currentProject);

    const order: string[] = [];
    const composer = new Composer<Context>();
    composer.use(telegramInputOrderMiddleware);
    composer.command("new", () => {
      currentSession = { id: "session-b", title: "B", directory: "/repo-b" };
      order.push("new:session-b");
    });
    composer.on("message:voice", () => {
      order.push(`voice:${currentSession.id}`);
    });
    composer.on("message:audio", () => {
      order.push(`audio:${currentSession.id}`);
    });
    composer.on(
      "message",
      createMediaGroupAttachmentMiddleware(
        {
          bot: {} as never,
          ensureEventSubscription: vi.fn(),
          downloadFile: vi.fn(async () => ({ buffer: Buffer.from("image"), filePath: "image" })),
          getModelCapabilities: vi.fn(async () => MODEL_CAPABILITIES),
          getStoredModel: vi.fn(() => ({ providerID: "test", modelID: "test" })),
          processPrompt: vi.fn(async (_ctx, _input, _deps, options) => {
            order.push(`album:${options?.target?.sessionId}:${options?.target?.directory}`);
            return true;
          }),
        },
        { debounceMs: 10 },
      ),
    );
    composer.on("message:photo", () => {
      order.push(`photo:${currentSession.id}`);
    });
    composer.on("message:document", () => {
      order.push(`document:${currentSession.id}`);
    });

    const api = {
      sendMessage: vi.fn(async () => ({ message_id: 100, date: 1, chat: { id: 777, type: "private" }, text: "ok" })),
    } as unknown as Api;
    const dispatch = async (update: Update): Promise<void> => {
      const ctx = new Context(update, api, BOT_INFO);
      await composer.middleware()(ctx, vi.fn() as unknown as NextFunction);
    };

    await dispatch(
      messageUpdate(10, {
        media_group_id: "album-1",
        photo: [{ file_id: "photo", file_unique_id: "photo-u", width: 10, height: 10 }],
      }),
    );

    await Promise.all([
      dispatch(messageUpdate(11, { text: "/new", entities: [{ type: "bot_command", offset: 0, length: 4 }] })),
      dispatch(messageUpdate(12, { voice: { file_id: "voice", file_unique_id: "voice-u", duration: 1 } })),
      dispatch(messageUpdate(13, { audio: { file_id: "audio", file_unique_id: "audio-u", duration: 1 } })),
      dispatch(messageUpdate(14, { photo: [{ file_id: "single", file_unique_id: "single-u", width: 10, height: 10 }] })),
      dispatch(messageUpdate(15, { document: { file_id: "doc", file_unique_id: "doc-u" } })),
    ]);

    expect(order[0]).toBe("album:session-a:/repo-a");
    expect(order).toEqual(
      expect.arrayContaining([
        "new:session-b",
        "voice:session-b",
        "audio:session-b",
        "photo:session-b",
        "document:session-b",
      ]),
    );
  });

  it("holds a project-switch callback behind an earlier album", async () => {
    let currentSession = { id: "session-a", title: "A", directory: "/repo-a" };
    let currentProject = { id: "project-a", worktree: "/repo-a" };
    vi.spyOn(sessionService, "getCurrentSession").mockImplementation(() => currentSession);
    vi.spyOn(settingsStore, "getCurrentProject").mockImplementation(() => currentProject);

    const order: string[] = [];
    const composer = new Composer<Context>();
    composer.use(telegramInputOrderMiddleware);
    composer.callbackQuery("project:switch", () => {
      currentProject = { id: "project-b", worktree: "/repo-b" };
      currentSession = { id: "session-b", title: "B", directory: "/repo-b" };
      order.push("project:session-b");
    });
    composer.on(
      "message",
      createMediaGroupAttachmentMiddleware(
        {
          bot: {} as never,
          ensureEventSubscription: vi.fn(),
          downloadFile: vi.fn(async () => ({ buffer: Buffer.from("image"), filePath: "image" })),
          getModelCapabilities: vi.fn(async () => MODEL_CAPABILITIES),
          getStoredModel: vi.fn(() => ({ providerID: "test", modelID: "test" })),
          processPrompt: vi.fn(async (_ctx, _input, _deps, options) => {
            order.push(`album:${options?.target?.sessionId}`);
            return true;
          }),
        },
        { debounceMs: 10 },
      ),
    );

    const api = {
      sendMessage: vi.fn(async () => ({ message_id: 100, date: 1, chat: { id: 777, type: "private" }, text: "ok" })),
    } as unknown as Api;
    const dispatch = async (update: Update): Promise<void> => {
      await composer.middleware()(new Context(update, api, BOT_INFO), vi.fn() as unknown as NextFunction);
    };

    await dispatch(
      messageUpdate(20, {
        media_group_id: "album-2",
        photo: [{ file_id: "photo", file_unique_id: "photo-u", width: 10, height: 10 }],
      }),
    );
    const callback = dispatch({
      update_id: 21,
      callback_query: {
        id: "callback-1",
        chat_instance: "chat-instance",
        data: "project:switch",
        from: { id: 1, is_bot: false, first_name: "User" },
        message: {
          message_id: 19,
          date: 1,
          chat: { id: 777, type: "private", first_name: "User" },
          text: "Projects",
        },
      },
    } as Update);

    await callback;
    expect(order).toEqual(["album:session-a", "project:session-b"]);
  });
});
