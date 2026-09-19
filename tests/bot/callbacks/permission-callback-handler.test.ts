import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, InlineKeyboard } from "grammy";
import type { PermissionRequest } from "../../../src/app/types/permission.js";
import { showPermissionRequest } from "../../../src/bot/menus/permission-menu.js";
import { handlePermissionCallback } from "../../../src/bot/callbacks/permission-callback-handler.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

const mocked = vi.hoisted(() => ({
  permissionReplyMock: vi.fn(),
  currentProject: {
    id: "project-1",
    worktree: "D:/repo",
  } as { id: string; worktree: string } | undefined,
  currentSession: null as { id: string; title: string; directory: string } | null,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    permission: {
      reply: mocked.permissionReplyMock,
    },
  },
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: ({
    task,
    onSuccess,
    onError,
  }: {
    task: () => Promise<unknown>;
    onSuccess?: (value: unknown) => void | Promise<void>;
    onError?: (error: unknown) => void | Promise<void>;
  }) => {
    void task()
      .then((result) => {
        if (onSuccess) {
          void onSuccess(result);
        }
      })
      .catch((error) => {
        if (onError) {
          void onError(error);
        }
      });
  },
}));

function createPermissionRequest(
  id: string,
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id,
    sessionID: "session-1",
    permission: "bash",
    patterns: ["npm test"],
    metadata: {},
    always: [],
    ...overrides,
  };
}

function createBotApi(messageId: number = 500): Context["api"] {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: messageId }),
    editMessageText: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
  } as unknown as Context["api"];
}

function createPermissionCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as Context;
}

function getCallbackData(button: unknown): string | undefined {
  if (!button || typeof button !== "object") {
    return undefined;
  }

  const maybeButton = button as { callback_data?: string };
  return maybeButton.callback_data;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createDeps() {
  return container;
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot permission menu/callbacks", () => {
  beforeEach(() => {
    container.permissionManager.clear();
    container.interactionManager.clear("test_setup");

    mocked.permissionReplyMock.mockReset();
    mocked.permissionReplyMock.mockResolvedValue({ error: null });

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:/repo",
    };
    mocked.currentSession = null;
  });

  it("starts permission interaction and stores message id", async () => {
    const botApi = createBotApi(500);
    const request = createPermissionRequest("perm-1");

    await showPermissionRequest(botApi, 777, request, createDeps());

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const call = defined(sendMessageMock.mock.calls[0]);
    const [, , options] = call;
    const replyMarkup = (options as { reply_markup: InlineKeyboard }).reply_markup;

    expect(replyMarkup.inline_keyboard).toHaveLength(3);
    expect(replyMarkup.inline_keyboard[0]?.[0]?.text).toBe(t("permission.button.allow"));
    expect(getCallbackData(replyMarkup.inline_keyboard[0]?.[0])).toBe("permission:once");
    expect(replyMarkup.inline_keyboard[1]?.[0]?.text).toBe(t("permission.button.always"));
    expect(getCallbackData(replyMarkup.inline_keyboard[1]?.[0])).toBe("permission:always");
    expect(replyMarkup.inline_keyboard[2]?.[0]?.text).toBe(t("permission.button.reject"));
    expect(getCallbackData(replyMarkup.inline_keyboard[2]?.[0])).toBe("permission:reject");

    expect(container.permissionManager.isActive()).toBe(true);
    expect(container.permissionManager.getRequestID(500)).toBe("perm-1");
    expect(container.permissionManager.getMessageId()).toBe(500);
    expect(container.permissionManager.getPendingCount()).toBe(1);

    const state = container.interactionManager.getSnapshot();
    expect(state?.kind).toBe("permission");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.requestID).toBe("perm-1");
    expect(state?.metadata.messageId).toBe(500);
  });

  it("keeps multiple active permission requests without deleting previous messages", async () => {
    const botApi = createBotApi(500);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"), createDeps());

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 501 });

    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-2", { patterns: ["npm run build"] }),
      createDeps(),
    );

    const deleteMessageMock = botApi.deleteMessage as unknown as ReturnType<typeof vi.fn>;
    expect(deleteMessageMock).not.toHaveBeenCalled();

    expect(container.permissionManager.getRequestID(500)).toBe("perm-1");
    expect(container.permissionManager.getRequestID(501)).toBe("perm-2");
    expect(container.permissionManager.getMessageId()).toBe(501);
    expect(container.permissionManager.getMessageIds()).toEqual([500, 501]);
    expect(container.permissionManager.getPendingCount()).toBe(2);

    const state = container.interactionManager.getSnapshot();
    expect(state?.kind).toBe("permission");
    expect(state?.metadata.requestID).toBe("perm-2");
    expect(state?.metadata.messageId).toBe(501);
    expect(state?.metadata.pendingCount).toBe(2);
  });

  it("does not show a permission request that was already resolved", async () => {
    const botApi = createBotApi(502);
    container.permissionManager.resolveRequest("perm-resolved");

    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-resolved"),
      createDeps(),
    );

    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("does not send a permission message from a cleared lifecycle", async () => {
    const botApi = createBotApi(503);
    const generation = container.permissionManager.getGeneration();
    container.permissionManager.clear();

    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-old-lifecycle"),
      createDeps(),
      generation,
    );

    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(container.permissionManager.isActive()).toBe(false);
  });

  it("discards an in-flight permission message after state is cleared", async () => {
    let resolveSend: (message: { message_id: number }) => void = () => {};
    const pendingSend = new Promise<{ message_id: number }>((resolve) => {
      resolveSend = resolve;
    });
    const botApi = {
      sendMessage: vi.fn().mockReturnValue(pendingSend),
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as unknown as Context["api"];

    const showTask = showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-old-session"),
      createDeps(),
    );
    await vi.waitFor(() => {
      expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    });
    container.permissionManager.clear();
    resolveSend({ message_id: 503 });

    await showTask;

    expect(botApi.deleteMessage).toHaveBeenCalledWith(777, 503);
    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("rejects callback from unknown permission message", async () => {
    const botApi = createBotApi(500);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"), createDeps());

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 501 });
    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-2", { patterns: ["npm run build"] }),
      createDeps(),
    );

    const staleCtx = createPermissionCallbackContext("permission:once", 499);
    const handled = await handlePermissionCallback(staleCtx, createDeps());

    expect(handled).toBe(true);
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("permission.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.permissionReplyMock).not.toHaveBeenCalled();

    expect(container.permissionManager.isActive()).toBe(true);
    expect(container.permissionManager.getPendingCount()).toBe(2);
    expect(container.permissionManager.getRequestID(501)).toBe("perm-2");
  });

  it("handles valid permission reply and clears active states", async () => {
    const botApi = createBotApi(600);
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-valid"), createDeps());

    const ctx = createPermissionCallbackContext("permission:always", 600);
    const handled = await handlePermissionCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("permission.reply.always") });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-valid",
      directory: "D:/repo",
      reply: "always",
    });

    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("deduplicates equivalent permission requests behind one Telegram message", async () => {
    const botApi = createBotApi(650);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"), createDeps());
    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-duplicate"),
      createDeps(),
    );

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    expect(container.permissionManager.getPendingCount()).toBe(1);
    expect(container.permissionManager.getRequestID(650)).toBe("perm-1");
    expect(container.permissionManager.getRequestIDs(650)).toEqual(["perm-1", "perm-duplicate"]);

    const ctx = createPermissionCallbackContext("permission:always", 650);
    const handled = await handlePermissionCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("permission.reply.always") });

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledTimes(2);
    expect(mocked.permissionReplyMock).toHaveBeenNthCalledWith(1, {
      requestID: "perm-1",
      directory: "D:/repo",
      reply: "always",
    });
    expect(mocked.permissionReplyMock).toHaveBeenNthCalledWith(2, {
      requestID: "perm-duplicate",
      directory: "D:/repo",
      reply: "always",
    });
    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("shows the grouped request count on the visible permission message", async () => {
    const botApi = createBotApi(651);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"), createDeps());
    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-duplicate"),
      createDeps(),
    );

    const editMessageTextMock = botApi.editMessageText as unknown as ReturnType<typeof vi.fn>;
    expect(editMessageTextMock).toHaveBeenCalledTimes(1);

    const call = defined(editMessageTextMock.mock.calls[0]);
    const [chatId, messageId, text] = call;
    expect(chatId).toBe(777);
    expect(messageId).toBe(651);
    expect(text).toContain(t("permission.grouped_count", { count: 2 }));
  });

  it("refuses to group stale or already resolved equivalent requests", async () => {
    const botApi = createBotApi(652);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"), createDeps());
    const generation = container.permissionManager.getGeneration();

    container.permissionManager.resolveRequest("perm-resolved");
    expect(
      container.permissionManager.addEquivalentRequest(createPermissionRequest("perm-resolved")),
    ).toBeNull();
    expect(
      container.permissionManager.addEquivalentRequest(createPermissionRequest("perm-stale"), generation - 1),
    ).toBeNull();

    expect(container.permissionManager.getRequestIDs(652)).toEqual(["perm-1"]);
  });

  it("does not group behind a message whose request was replaced", async () => {
    const botApi = createBotApi(653);

    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-replaced"),
      createDeps(),
    );
    // Same Telegram message id, different scope: the replaced request's
    // signature must no longer group new requests behind it.
    container.permissionManager.startPermission(createPermissionRequest("perm-2", { patterns: ["ls"] }), 653);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-3"), createDeps());

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(botApi.editMessageText).not.toHaveBeenCalled();
  });

  it("resolves a grouped permission prompt by any grouped request id", async () => {
    const botApi = createBotApi(655);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"), createDeps());
    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-duplicate"),
      createDeps(),
    );

    expect(container.permissionManager.resolveRequest("perm-duplicate")).toEqual([655]);
    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.permissionManager.getRequestIDs(655)).toEqual([]);
  });

  it("ignores duplicate permission not-found errors after replying grouped requests", async () => {
    const botApi = createBotApi(660);
    mocked.permissionReplyMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        error: {
          _tag: "PermissionNotFoundError",
          requestID: "perm-duplicate",
          message: "Permission request not found: perm-duplicate",
        },
      });

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"), createDeps());
    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-duplicate"),
      createDeps(),
    );

    const ctx = createPermissionCallbackContext("permission:always", 660);
    await handlePermissionCallback(ctx, createDeps());
    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledTimes(2);
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps permission interaction active until all requests are replied", async () => {
    const botApi = createBotApi(700);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"), createDeps());

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 701 });
    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-2", { patterns: ["npm run build"] }),
      createDeps(),
    );

    const firstCtx = createPermissionCallbackContext("permission:once", 700);
    const firstHandled = await handlePermissionCallback(firstCtx, createDeps());

    expect(firstHandled).toBe(true);
    expect(firstCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("permission.reply.once") });

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-1",
      directory: "D:/repo",
      reply: "once",
    });

    expect(container.permissionManager.isActive()).toBe(true);
    expect(container.permissionManager.getPendingCount()).toBe(1);
    expect(container.permissionManager.getRequestID(701)).toBe("perm-2");

    const stateAfterFirstReply = container.interactionManager.getSnapshot();
    expect(stateAfterFirstReply?.kind).toBe("permission");
    expect(stateAfterFirstReply?.expectedInput).toBe("callback");
    expect(stateAfterFirstReply?.metadata.pendingCount).toBe(1);

    const secondCtx = createPermissionCallbackContext("permission:reject", 701);
    const secondHandled = await handlePermissionCallback(secondCtx, createDeps());

    expect(secondHandled).toBe(true);
    expect(secondCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("permission.reply.reject"),
    });

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-2",
      directory: "D:/repo",
      reply: "reject",
    });

    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("does not report an error when the permission request was already resolved", async () => {
    const botApi = createBotApi(750);
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-stale"), createDeps());
    mocked.permissionReplyMock.mockResolvedValueOnce({
      error: {
        name: "NotFoundError",
        data: { message: "Permission request not found" },
      },
    });

    const ctx = createPermissionCallbackContext("permission:always", 750);
    await handlePermissionCallback(ctx, createDeps());
    await flushMicrotasks();

    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("keeps reporting non-stale permission reply errors", async () => {
    const botApi = createBotApi(751);
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-error"), createDeps());
    mocked.permissionReplyMock.mockResolvedValueOnce({
      error: { name: "ServerError", data: { message: "Permission service unavailable" } },
    });

    const ctx = createPermissionCallbackContext("permission:once", 751);
    await handlePermissionCallback(ctx, createDeps());
    await flushMicrotasks();

    expect(ctx.api.sendMessage).toHaveBeenCalledWith(777, t("permission.send_reply_error"));
  });

  it("clears states when permission message cannot be sent", async () => {
    const botApi = {
      sendMessage: vi.fn().mockRejectedValue(new Error("send failed")),
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as unknown as Context["api"];

    await expect(
      showPermissionRequest(botApi, 777, createPermissionRequest("perm-fail"), createDeps()),
    ).rejects.toThrow("send failed");

    expect(container.permissionManager.isActive()).toBe(false);
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("sends permission text in raw mode for underscore-based permission names", async () => {
    const botApi = createBotApi(800);

    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-external", {
        permission: "external_directory",
        patterns: ["D:/data/my_project"],
      }),
      createDeps(),
    );

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const call = defined(sendMessageMock.mock.calls[0]);
    const [, text, options] = call;

    expect(text).toContain(t("permission.name.external_directory"));
    expect(text).toContain("• D:/data/my_project");
    expect(options).not.toHaveProperty("parse_mode");
  });
});
