import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractionManager } from "../../../src/app/managers/interaction-manager.js";
import { QuestionManager } from "../../../src/app/managers/question-manager.js";
import { PermissionManager } from "../../../src/app/managers/permission-manager.js";
import { RenameManager } from "../../../src/app/managers/rename-manager.js";
import type { Question } from "../../../src/app/types/question.js";
import type { PermissionRequest } from "../../../src/app/types/permission.js";

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

let interactionManager: InteractionManager;
let questionManager: QuestionManager;
let permissionManager: PermissionManager;
let renameManager: RenameManager;

beforeEach(() => {
  interactionManager = new InteractionManager();
  questionManager = new QuestionManager(interactionManager);
  permissionManager = new PermissionManager(interactionManager);
  renameManager = new RenameManager(interactionManager);
});

describe("app/managers/interaction-cleanup", () => {
  beforeEach(() => {
    interactionManager.reset("test_setup");
  });

  afterEach(() => {
    interactionManager.setOnWaitingRequestReady(null);
  });

  it("clears the slot and the waiting request together", async () => {
    const listener = vi.fn();
    interactionManager.setOnWaitingRequestReady(listener);
    questionManager.startQuestions([TEST_QUESTION], "req-1");
    interactionManager.waitPermission(TEST_PERMISSION);
    const generation = interactionManager.getGeneration();

    interactionManager.reset("test_cleanup");
    await new Promise((resolve) => setImmediate(resolve));

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(interactionManager.getWaitingKind()).toBeNull();
    expect(interactionManager.getGeneration()).toBe(generation + 1);
    expect(listener).not.toHaveBeenCalled();
  });

  it("clears a rename flow", () => {
    renameManager.startWaiting("session-1", "D:/repo", "Old title");

    interactionManager.reset("test_cleanup");

    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("allows starting new interaction after cleanup", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: { menuKind: "model", messageId: 1 },
    });

    interactionManager.reset("first_cleanup");

    questionManager.startQuestions([TEST_QUESTION], "req-2");

    expect(interactionManager.getSnapshot()?.kind).toBe("question");
  });
});
