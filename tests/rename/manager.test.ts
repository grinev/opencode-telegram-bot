import { describe, expect, it, beforeEach } from "vitest";
import { renameManager } from "../../src/rename/manager.js";

describe("renameManager", () => {
  beforeEach(() => {
    renameManager.clear();
  });

  it("starts waiting for rename and tracks state", () => {
    renameManager.startWaiting("session-123", "/path/to/project", "Old Title");

    expect(renameManager.isWaitingForName()).toBe(true);
    const info = renameManager.getSessionInfo();
    expect(info).toEqual({
      sessionId: "session-123",
      directory: "/path/to/project",
      currentTitle: "Old Title",
    });
  });

  it("tracks message ID for cleanup", () => {
    renameManager.startWaiting("session-456", "/path", "Test");
    renameManager.setMessageId(42);

    expect(renameManager.getMessageId()).toBe(42);
    expect(renameManager.isActiveMessage(42)).toBe(true);
    expect(renameManager.isActiveMessage(99)).toBe(false);
  });

  it("clears state completely", () => {
    renameManager.startWaiting("session-789", "/path", "Title");
    renameManager.setMessageId(100);

    renameManager.clear();

    expect(renameManager.isWaitingForName()).toBe(false);
    expect(renameManager.getSessionInfo()).toBeNull();
    expect(renameManager.getMessageId()).toBeNull();
  });

  it("returns null session info when not waiting", () => {
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(renameManager.getSessionInfo()).toBeNull();
  });
});
