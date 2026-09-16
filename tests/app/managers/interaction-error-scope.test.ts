import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllInteractionState,
  clearInteractionErrorState,
  interactionManager,
} from "../../../src/app/managers/interaction-manager.js";
import { permissionManager } from "../../../src/app/managers/permission-manager.js";
import { questionManager } from "../../../src/app/managers/question-manager.js";
import { renameManager } from "../../../src/app/managers/rename-manager.js";
import { taskCreationManager } from "../../../src/app/managers/scheduled-task-creation-manager.js";
import type { PermissionRequest } from "../../../src/app/types/permission.js";
import type { Question } from "../../../src/app/types/question.js";

const TEST_QUESTION: Question = {
  header: "Q1",
  question: "Pick one option",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const TEST_PERMISSION: PermissionRequest = {
  id: "perm-1",
  sessionID: "session-1",
  permission: "bash",
  patterns: ["npm test"],
  metadata: {},
  always: [],
};

describe("app/managers/interaction-error-scope", () => {
  beforeEach(() => {
    clearAllInteractionState("test_setup");
  });

  afterEach(() => {
    interactionManager.setOnWaitingRequestReady(null);
  });

  it("clears only questionManager for the question scope", () => {
    questionManager.startQuestions([TEST_QUESTION], "req-1");

    clearInteractionErrorState("question", "test_cleanup");

    expect(questionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("keeps an unrelated interaction for the question scope", () => {
    interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: {} });

    clearInteractionErrorState("question", "test_cleanup");

    expect(questionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()?.kind).toBe("inline");
  });

  it("keeps waiting permissions for the question scope and releases them", async () => {
    const listener = vi.fn();
    interactionManager.setOnWaitingRequestReady(listener);
    questionManager.startQuestions([TEST_QUESTION], "req-1");
    interactionManager.waitPermission(TEST_PERMISSION);
    const generation = interactionManager.getGeneration();

    clearInteractionErrorState("question", "test_cleanup");
    await new Promise((resolve) => setImmediate(resolve));

    expect(listener).toHaveBeenCalledWith(
      { kind: "permission", requests: [TEST_PERMISSION] },
      generation,
    );
  });

  it("releases a waiting poll with the bumped generation for the permission scope", async () => {
    const listener = vi.fn();
    interactionManager.setOnWaitingRequestReady(listener);
    permissionManager.startPermission(TEST_PERMISSION, 101);
    interactionManager.waitQuestion([TEST_QUESTION], "req-1", "session-1");
    const generation = interactionManager.getGeneration();

    clearInteractionErrorState("permission", "test_cleanup");
    await new Promise((resolve) => setImmediate(resolve));

    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getGeneration()).toBe(generation + 1);
    expect(listener).toHaveBeenCalledWith(
      { kind: "question", questions: [TEST_QUESTION], requestID: "req-1", sessionId: "session-1" },
      generation + 1,
    );
  });

  it("clears only permissionManager for the permission scope", () => {
    permissionManager.startPermission(TEST_PERMISSION, 101);

    clearInteractionErrorState("permission", "test_cleanup");

    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("clears renameManager and the matching interaction for the rename scope", () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title");

    clearInteractionErrorState("rename", "test_cleanup");

    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("keeps an unrelated interaction for the rename scope", () => {
    questionManager.startQuestions([TEST_QUESTION], "req-1");

    clearInteractionErrorState("rename", "test_cleanup");

    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()?.kind).toBe("question");
  });

  it("clears taskCreationManager and the matching interaction for the taskCreation scope", () => {
    taskCreationManager.start("project-1", "D:/repo", { providerID: "p", modelID: "m", variant: null }, "build");

    clearInteractionErrorState("taskCreation", "test_cleanup");

    expect(taskCreationManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("clears the interaction unconditionally for the interaction scope", () => {
    interactionManager.start({ kind: "inline", expectedInput: "callback", metadata: {} });

    clearInteractionErrorState("interaction", "test_cleanup");

    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("does nothing for the none scope", () => {
    questionManager.startQuestions([TEST_QUESTION], "req-1");

    clearInteractionErrorState("none", "test_cleanup");

    expect(questionManager.isActive()).toBe(true);
    expect(interactionManager.getSnapshot()?.kind).toBe("question");
  });
});
