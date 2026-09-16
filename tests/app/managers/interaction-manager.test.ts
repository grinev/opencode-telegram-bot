import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ALLOWED_INTERACTION_COMMANDS,
  clearAllInteractionState,
  interactionManager,
} from "../../../src/app/managers/interaction-manager.js";
import { permissionManager } from "../../../src/app/managers/permission-manager.js";
import { questionManager } from "../../../src/app/managers/question-manager.js";
import { renameManager } from "../../../src/app/managers/rename-manager.js";
import { taskCreationManager } from "../../../src/app/managers/scheduled-task-creation-manager.js";
import type { PermissionRequest } from "../../../src/app/types/permission.js";
import type { Question } from "../../../src/app/types/question.js";

describe("interactionManager", () => {
  beforeEach(() => {
    interactionManager.__resetForTests();
  });

  it("starts interaction with defaults", () => {
    const state = interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: { requestId: "q-1" },
    });

    expect(state.kind).toBe("custom");
    expect(state.expectedInput).toBe("callback");
    expect(state.metadata).toEqual({ requestId: "q-1" });
    expect(state.allowedCommands).toEqual([...DEFAULT_ALLOWED_INTERACTION_COMMANDS]);
    expect(state.createdAt).toBeTypeOf("number");
    expect(state.expiresAt).toBeNull();
    expect(interactionManager.isActive()).toBe(true);
  });

  it("normalizes and deduplicates allowed commands", () => {
    const state = interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/Help", "status", "/help", " /STATUS@MyBot ", "detach", "", " / "],
    });

    expect(state.allowedCommands).toEqual(["/help", "/status", "/detach"]);
  });

  it("transitions active interaction", () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "text",
      metadata: { step: 1 },
    });

    const transitioned = interactionManager.transition({
      expectedInput: "mixed",
      allowedCommands: ["/abort"],
      metadata: { step: 2 },
      expiresInMs: 5000,
    });

    expect(transitioned).not.toBeNull();
    expect(transitioned?.kind).toBe("custom");
    expect(transitioned?.expectedInput).toBe("mixed");
    expect(transitioned?.allowedCommands).toEqual(["/abort"]);
    expect(transitioned?.metadata).toEqual({ step: 2 });
    expect(typeof transitioned?.expiresAt).toBe("number");
  });

  it("tracks expiration by expiresAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      expiresInMs: 1000,
    });

    expect(interactionManager.isExpired()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(interactionManager.isExpired()).toBe(true);
  });

  it("clears active interaction", () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
    });

    interactionManager.clear("test");

    expect(interactionManager.isActive()).toBe(false);
    expect(interactionManager.get()).toBeNull();
  });
});

describe("interactionManager waiting request", () => {
  const QUESTIONS: Question[] = [
    { header: "Q", question: "Pick", options: [{ label: "A", description: "first" }] },
  ];

  function permission(id: string): PermissionRequest {
    return {
      id,
      sessionID: "session-1",
      permission: "bash",
      patterns: [id],
      metadata: {},
      always: [],
    };
  }

  function startPoll(): void {
    questionManager.startQuestions(QUESTIONS, "req-1");
  }

  async function nextTick(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
  }

  beforeEach(() => {
    interactionManager.__resetForTests();
  });

  it("releases the waiting request to the listener when the agent request is cleared", async () => {
    const listener = vi.fn();
    interactionManager.setOnWaitingRequestReady(listener);
    startPoll();
    interactionManager.waitPermission(permission("perm-1"));
    interactionManager.waitPermission(permission("perm-2"));
    interactionManager.waitPermission(permission("perm-1"));

    interactionManager.clear("question_completed");

    expect(listener).not.toHaveBeenCalled();
    await nextTick();
    expect(listener).toHaveBeenCalledWith(
      { kind: "permission", requests: [permission("perm-1"), permission("perm-2")] },
      0,
    );
    expect(interactionManager.getWaitingKind()).toBeNull();
  });

  it("does not release the waiting request when the slot is replaced", async () => {
    const listener = vi.fn();
    interactionManager.setOnWaitingRequestReady(listener);
    startPoll();
    interactionManager.waitPermission(permission("perm-1"));

    questionManager.startQuestions(QUESTIONS, "req-2");
    await nextTick();

    expect(listener).not.toHaveBeenCalled();
    expect(questionManager.getRequestID()).toBe("req-2");
    expect(interactionManager.getWaitingKind()).toBe("permission");
  });

  it("does not release anything when a user flow is cleared", async () => {
    const listener = vi.fn();
    interactionManager.setOnWaitingRequestReady(listener);
    interactionManager.start({ kind: "inline", expectedInput: "callback" });

    interactionManager.clear("inline_closed");
    await nextTick();

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps only the latest waiting poll", async () => {
    const listener = vi.fn();
    interactionManager.setOnWaitingRequestReady(listener);
    permissionManager.startPermission(permission("perm-1"), 101);
    interactionManager.waitQuestion(QUESTIONS, "req-old", "session-1");
    interactionManager.waitQuestion(QUESTIONS, "req-new", "session-1");

    interactionManager.clearKind("permission", "permission_replied");
    await nextTick();

    expect(listener).toHaveBeenCalledWith(
      { kind: "question", questions: QUESTIONS, requestID: "req-new", sessionId: "session-1" },
      0,
    );
  });

  it("drops waiting permissions by request id and waiting polls on demand", () => {
    startPoll();
    interactionManager.waitPermission(permission("perm-1"));
    interactionManager.waitPermission(permission("perm-2"));

    permissionManager.resolveRequest("perm-1");
    expect(interactionManager.getWaitingKind()).toBe("permission");
    permissionManager.resolveRequest("perm-2");
    expect(interactionManager.getWaitingKind()).toBeNull();

    interactionManager.clear("question_completed");
    permissionManager.startPermission(permission("perm-3"), 103);
    interactionManager.waitQuestion(QUESTIONS, "req-1", "session-1");
    expect(interactionManager.dropWaitingQuestion()).toBe(true);
    expect(interactionManager.getWaitingKind()).toBeNull();
  });

  it("clearKind leaves another kind in place", () => {
    startPoll();

    interactionManager.clearKind("permission", "permission_replied");
    renameManager.clear();
    taskCreationManager.clear();

    expect(questionManager.isActive()).toBe(true);
  });
});

describe("stateful managers on the shared slot", () => {
  const QUESTIONS: Question[] = [
    { header: "Q", question: "Pick", options: [{ label: "A", description: "first" }] },
  ];
  const PERMISSION: PermissionRequest = {
    id: "perm-1",
    sessionID: "session-1",
    permission: "bash",
    patterns: ["npm test"],
    metadata: {},
    always: [],
  };

  beforeEach(() => {
    interactionManager.__resetForTests();
    permissionManager.__resetForTests();
  });

  it("refuses to start a poll while permissions are on screen", () => {
    permissionManager.startPermission(PERMISSION, 101);

    expect(questionManager.startQuestions(QUESTIONS, "req-1")).toBe(false);
    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.getPendingCount()).toBe(1);
  });

  it("refuses to register a permission while a poll is on screen", () => {
    questionManager.startQuestions(QUESTIONS, "req-1");

    expect(permissionManager.startPermission(PERMISSION, 101)).toBe("question_active");
    expect(permissionManager.isActive()).toBe(false);
    expect(questionManager.isActive()).toBe(true);
  });

  it("reports a stale or resolved request before a poll on screen", () => {
    questionManager.startQuestions(QUESTIONS, "req-1");
    const generation = permissionManager.getGeneration();

    permissionManager.resolveRequest("perm-1");
    expect(permissionManager.startPermission(PERMISSION, 101)).toBe("resolved");

    interactionManager.bumpGeneration();
    expect(permissionManager.startPermission({ ...PERMISSION, id: "perm-2" }, 102, generation)).toBe(
      "stale",
    );
  });

  it("lets an agent request preempt a user flow", () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title");

    expect(permissionManager.startPermission(PERMISSION, 101)).toBe("started");
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()?.kind).toBe("permission");
  });

  it("does not bump the generation when the last permission ends normally", () => {
    permissionManager.startPermission(PERMISSION, 101);
    const generation = permissionManager.getGeneration();

    permissionManager.removeByMessageId(101);
    interactionManager.clearKind("permission", "permission_replied");

    expect(permissionManager.getGeneration()).toBe(generation);

    permissionManager.startPermission(PERMISSION, 102);
    permissionManager.clear();
    expect(permissionManager.getGeneration()).toBe(generation + 1);
  });

  it("forgets resolved ids after a reset", () => {
    permissionManager.resolveRequest("perm-1");
    expect(permissionManager.isResolved("perm-1")).toBe(true);

    clearAllInteractionState("test_reset");

    expect(permissionManager.isResolved("perm-1")).toBe(false);
  });

  it("keeps task creation data in the slot", () => {
    taskCreationManager.start("project-1", "D:/repo", { providerID: "p", modelID: "m", variant: null }, "build");
    taskCreationManager.markScheduleParsing();

    expect(taskCreationManager.isParsingSchedule()).toBe(true);
    expect(interactionManager.getSnapshot()?.kind).toBe("task");

    questionManager.startQuestions(QUESTIONS, "req-1");

    expect(taskCreationManager.isActive()).toBe(false);
    expect(taskCreationManager.getState()).toBeNull();
  });
});
