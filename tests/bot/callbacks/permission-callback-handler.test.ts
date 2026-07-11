import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, InlineKeyboard } from "grammy";
import type { PermissionRequest } from "../../../src/app/types/permission.js";
import { permissionManager } from "../../../src/app/managers/permission-manager.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { showPermissionRequest } from "../../../src/bot/menus/permission-menu.js";
import { handlePermissionCallback } from "../../../src/bot/callbacks/permission-callback-handler.js";
import { t } from "../../../src/i18n/index.js";

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
}

describe("bot permission menu/callbacks", () => {
  beforeEach(() => {
    permissionManager.clear();
    interactionManager.clear("test_setup");

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

    await showPermissionRequest(botApi, 777, request);

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const [, , options] = sendMessageMock.mock.calls[0];
    const replyMarkup = (options as { reply_markup: InlineKeyboard }).reply_markup;

    expect(replyMarkup.inline_keyboard).toHaveLength(3);
    expect(replyMarkup.inline_keyboard[0]?.[0]?.text).toBe(t("permission.button.allow"));
    expect(getCallbackData(replyMarkup.inline_keyboard[0]?.[0])).toBe("permission:once");
    expect(replyMarkup.inline_keyboard[1]?.[0]?.text).toBe(t("permission.button.always"));
    expect(getCallbackData(replyMarkup.inline_keyboard[1]?.[0])).toBe("permission:always");
    expect(replyMarkup.inline_keyboard[2]?.[0]?.text).toBe(t("permission.button.reject"));
    expect(getCallbackData(replyMarkup.inline_keyboard[2]?.[0])).toBe("permission:reject");

    expect(permissionManager.isActive()).toBe(true);
    expect(permissionManager.getRequestID(500)).toBe("perm-1");
    expect(permissionManager.getMessageId()).toBe(500);
    expect(permissionManager.getPendingCount()).toBe(1);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("permission");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.requestID).toBe("perm-1");
    expect(state?.metadata.messageId).toBe(500);
  });

  it("keeps multiple active permission requests without deleting previous messages", async () => {
    const botApi = createBotApi(500);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"));

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 501 });

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-2"));

    const deleteMessageMock = botApi.deleteMessage as unknown as ReturnType<typeof vi.fn>;
    expect(deleteMessageMock).not.toHaveBeenCalled();

    expect(permissionManager.getRequestID(500)).toBe("perm-1");
    expect(permissionManager.getRequestID(501)).toBe("perm-2");
    expect(permissionManager.getMessageId()).toBe(501);
    expect(permissionManager.getMessageIds()).toEqual([500, 501]);
    expect(permissionManager.getPendingCount()).toBe(2);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("permission");
    expect(state?.metadata.requestID).toBe("perm-2");
    expect(state?.metadata.messageId).toBe(501);
    expect(state?.metadata.pendingCount).toBe(2);
  });

  it("does not show a permission request that was already resolved", async () => {
    const botApi = createBotApi(502);
    permissionManager.resolveRequest("perm-resolved");

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-resolved"));

    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("does not send a permission message from a cleared lifecycle", async () => {
    const botApi = createBotApi(503);
    const generation = permissionManager.getGeneration();
    permissionManager.clear();

    await showPermissionRequest(
      botApi,
      777,
      createPermissionRequest("perm-old-lifecycle"),
      generation,
    );

    expect(botApi.sendMessage).not.toHaveBeenCalled();
    expect(permissionManager.isActive()).toBe(false);
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
    );
    await vi.waitFor(() => {
      expect(botApi.sendMessage).toHaveBeenCalledTimes(1);
    });
    permissionManager.clear();
    resolveSend({ message_id: 503 });

    await showTask;

    expect(botApi.deleteMessage).toHaveBeenCalledWith(777, 503);
    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("rejects callback from unknown permission message", async () => {
    const botApi = createBotApi(500);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"));

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 501 });
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-2"));

    const staleCtx = createPermissionCallbackContext("permission:once", 499);
    const handled = await handlePermissionCallback(staleCtx);

    expect(handled).toBe(true);
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("permission.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.permissionReplyMock).not.toHaveBeenCalled();

    expect(permissionManager.isActive()).toBe(true);
    expect(permissionManager.getPendingCount()).toBe(2);
    expect(permissionManager.getRequestID(501)).toBe("perm-2");
  });

  it("handles valid permission reply and clears active states", async () => {
    const botApi = createBotApi(600);
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-valid"));

    const ctx = createPermissionCallbackContext("permission:always", 600);
    const handled = await handlePermissionCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("permission.reply.always") });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-valid",
      directory: "D:/repo",
      reply: "always",
    });

    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("keeps permission interaction active until all requests are replied", async () => {
    const botApi = createBotApi(700);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"));

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 701 });
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-2"));

    const firstCtx = createPermissionCallbackContext("permission:once", 700);
    const firstHandled = await handlePermissionCallback(firstCtx);

    expect(firstHandled).toBe(true);
    expect(firstCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("permission.reply.once") });

    await flushMicrotasks();

    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "perm-1",
      directory: "D:/repo",
      reply: "once",
    });

    expect(permissionManager.isActive()).toBe(true);
    expect(permissionManager.getPendingCount()).toBe(1);
    expect(permissionManager.getRequestID(701)).toBe("perm-2");

    const stateAfterFirstReply = interactionManager.getSnapshot();
    expect(stateAfterFirstReply?.kind).toBe("permission");
    expect(stateAfterFirstReply?.expectedInput).toBe("callback");
    expect(stateAfterFirstReply?.metadata.pendingCount).toBe(1);

    const secondCtx = createPermissionCallbackContext("permission:reject", 701);
    const secondHandled = await handlePermissionCallback(secondCtx);

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

    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("does not report an error when the permission request was already resolved", async () => {
    const botApi = createBotApi(750);
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-stale"));
    mocked.permissionReplyMock.mockResolvedValueOnce({
      error: {
        name: "NotFoundError",
        data: { message: "Permission request not found" },
      },
    });

    const ctx = createPermissionCallbackContext("permission:always", 750);
    await handlePermissionCallback(ctx);
    await flushMicrotasks();

    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("keeps reporting non-stale permission reply errors", async () => {
    const botApi = createBotApi(751);
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-error"));
    mocked.permissionReplyMock.mockResolvedValueOnce({
      error: { name: "ServerError", data: { message: "Permission service unavailable" } },
    });

    const ctx = createPermissionCallbackContext("permission:once", 751);
    await handlePermissionCallback(ctx);
    await flushMicrotasks();

    expect(ctx.api.sendMessage).toHaveBeenCalledWith(777, t("permission.send_reply_error"));
  });

  it("clears states when permission message cannot be sent", async () => {
    const botApi = {
      sendMessage: vi.fn().mockRejectedValue(new Error("send failed")),
      deleteMessage: vi.fn().mockResolvedValue(true),
    } as unknown as Context["api"];

    await expect(
      showPermissionRequest(botApi, 777, createPermissionRequest("perm-fail")),
    ).rejects.toThrow("send failed");

    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
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
    );

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    const [, text, options] = sendMessageMock.mock.calls[0];

    expect(text).toContain(t("permission.name.external_directory"));
    expect(text).toContain("• D:/data/my_project");
    expect(options).not.toHaveProperty("parse_mode");
  });
});
