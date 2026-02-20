import { beforeEach, describe, expect, it } from "vitest";
import { clearAllInteractionState } from "../../src/interaction/cleanup.js";
import { interactionManager } from "../../src/interaction/manager.js";
import { questionManager } from "../../src/question/manager.js";
import { permissionManager } from "../../src/permission/manager.js";
import { renameManager } from "../../src/rename/manager.js";
import type { Question } from "../../src/question/types.js";
import type { PermissionRequest } from "../../src/permission/types.js";

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

describe("interaction/cleanup", () => {
  beforeEach(() => {
    clearAllInteractionState("test_setup");
  });

  it("clears all interaction-related managers", () => {
    questionManager.startQuestions([TEST_QUESTION], "req-1");
    permissionManager.startPermission(TEST_PERMISSION);
    renameManager.startWaiting("session-1", "D:/repo", "Old title");
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      metadata: { sessionId: "session-1" },
    });

    clearAllInteractionState("test_cleanup");

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("allows starting new interaction after cleanup", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: { menuKind: "model", messageId: 1 },
    });

    clearAllInteractionState("first_cleanup");

    interactionManager.start({
      kind: "question",
      expectedInput: "callback",
      metadata: { questionIndex: 0 },
    });

    expect(interactionManager.getSnapshot()?.kind).toBe("question");
  });
});
