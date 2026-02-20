import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, InlineKeyboard } from "grammy";
import type { PermissionRequest } from "../../../src/permission/types.js";
import { permissionManager } from "../../../src/permission/manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import {
  showPermissionRequest,
  handlePermissionCallback,
} from "../../../src/bot/handlers/permission.js";
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

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/session/manager.js", () => ({
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

function createPermissionRequest(id: string): PermissionRequest {
  return {
    id,
    sessionID: "session-1",
    permission: "bash",
    patterns: ["npm test"],
    metadata: {},
    always: [],
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

describe("bot/handlers/permission", () => {
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
    expect(permissionManager.getRequestID()).toBe("perm-1");
    expect(permissionManager.getMessageId()).toBe(500);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("permission");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.requestID).toBe("perm-1");
    expect(state?.metadata.messageId).toBe(500);
  });

  it("replaces active permission request and deletes previous message", async () => {
    const botApi = createBotApi(500);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"));

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 501 });

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-2"));

    const deleteMessageMock = botApi.deleteMessage as unknown as ReturnType<typeof vi.fn>;
    expect(deleteMessageMock).toHaveBeenCalledWith(777, 500);

    expect(permissionManager.getRequestID()).toBe("perm-2");
    expect(permissionManager.getMessageId()).toBe(501);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("permission");
    expect(state?.metadata.requestID).toBe("perm-2");
    expect(state?.metadata.messageId).toBe(501);
  });

  it("rejects stale callback from old permission message", async () => {
    const botApi = createBotApi(500);

    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-1"));

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    sendMessageMock.mockResolvedValueOnce({ message_id: 501 });
    await showPermissionRequest(botApi, 777, createPermissionRequest("perm-2"));

    const staleCtx = createPermissionCallbackContext("permission:once", 500);
    const handled = await handlePermissionCallback(staleCtx);

    expect(handled).toBe(true);
    expect(staleCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("permission.inactive_callback"),
      show_alert: true,
    });
    expect(mocked.permissionReplyMock).not.toHaveBeenCalled();

    expect(permissionManager.isActive()).toBe(true);
    expect(permissionManager.getRequestID()).toBe("perm-2");
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
});
