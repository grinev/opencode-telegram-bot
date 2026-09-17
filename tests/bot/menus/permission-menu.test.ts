import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  clearAllInteractionState,
  interactionManager,
} from "../../../src/app/managers/interaction-manager.js";
import { permissionManager } from "../../../src/app/managers/permission-manager.js";
import { questionManager } from "../../../src/app/managers/question-manager.js";
import type { PermissionRequest } from "../../../src/app/types/permission.js";
import { showPermissionRequest } from "../../../src/bot/menus/permission-menu.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

const deps = createTestAppContainer();

const PERMISSION: PermissionRequest = {
  id: "perm-1",
  sessionID: "session-1",
  permission: "bash",
  patterns: ["npm test"],
  metadata: {},
  always: [],
};

function createApi(onSend: () => void): {
  api: Context["api"];
  sendMessage: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
} {
  const sendMessage = vi.fn().mockImplementation(async () => {
    onSend();
    return { message_id: 201 };
  });
  const deleteMessage = vi.fn().mockResolvedValue(true);
  return {
    api: { sendMessage, deleteMessage, editMessageText: vi.fn() } as unknown as Context["api"],
    sendMessage,
    deleteMessage,
  };
}

describe("bot/menus/permission-menu", () => {
  beforeEach(() => {
    interactionManager.__resetForTests();
    permissionManager.__resetForTests();
  });

  it("shows the prompt and opens the permission slot", async () => {
    const { api, deleteMessage } = createApi(() => {});

    await showPermissionRequest(api, 42, PERMISSION, deps);

    expect(permissionManager.getRequestID(201)).toBe("perm-1");
    expect(interactionManager.getSnapshot()?.kind).toBe("permission");
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("deletes the prompt and queues the request when a poll took the slot during sending", async () => {
    const { api, deleteMessage } = createApi(() => {
      questionManager.startQuestions(
        [{ header: "Q", question: "Pick", options: [] }],
        "req-1",
      );
    });

    await showPermissionRequest(api, 42, PERMISSION, deps);

    expect(deleteMessage).toHaveBeenCalledWith(42, 201);
    expect(permissionManager.isActive()).toBe(false);
    expect(questionManager.isActive()).toBe(true);
    expect(interactionManager.getWaitingKind()).toBe("permission");
  });

  it("deletes and drops the prompt when a reset happened during sending", async () => {
    const { api, deleteMessage } = createApi(() => {
      questionManager.startQuestions(
        [{ header: "Q", question: "Pick", options: [] }],
        "req-1",
      );
      clearAllInteractionState("abort_command");
    });

    await showPermissionRequest(api, 42, PERMISSION, deps);

    expect(deleteMessage).toHaveBeenCalledWith(42, 201);
    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getWaitingKind()).toBeNull();
  });

  it("deletes and drops the prompt when it was answered elsewhere during sending", async () => {
    const { api, deleteMessage } = createApi(() => {
      questionManager.startQuestions(
        [{ header: "Q", question: "Pick", options: [] }],
        "req-1",
      );
      permissionManager.resolveRequest("perm-1");
    });

    await showPermissionRequest(api, 42, PERMISSION, deps);

    expect(deleteMessage).toHaveBeenCalledWith(42, 201);
    expect(interactionManager.getWaitingKind()).toBeNull();
  });

  it("skips sending a request that is already stale", async () => {
    const { api, sendMessage } = createApi(() => {});
    const generation = permissionManager.getGeneration();
    clearAllInteractionState("abort_command");

    await showPermissionRequest(api, 42, PERMISSION, deps, generation);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
