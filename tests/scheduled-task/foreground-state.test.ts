import { beforeEach, describe, expect, it } from "vitest";
import { foregroundSessionState } from "../../src/scheduled-task/foreground-state.js";

describe("scheduled-task/foreground-state", () => {
  beforeEach(() => {
    foregroundSessionState.__resetForTests();
  });

  it("tracks busy sessions with their directory", () => {
    foregroundSessionState.markBusy("session-1", "D:/repo");

    expect(foregroundSessionState.isBusy()).toBe(true);
    expect(foregroundSessionState.getBusySessions()).toEqual([
      { sessionId: "session-1", directory: "D:/repo", markedAt: expect.any(Number) },
    ]);
  });

  it("marks a busy session idle", () => {
    foregroundSessionState.markBusy("session-1", "D:/repo");

    foregroundSessionState.markIdle("session-1");

    expect(foregroundSessionState.isBusy()).toBe(false);
    expect(foregroundSessionState.getBusySessions()).toEqual([]);
  });

  it("clears all busy sessions", () => {
    foregroundSessionState.markBusy("session-1", "D:/repo-a");
    foregroundSessionState.markBusy("session-2", "D:/repo-b");

    foregroundSessionState.clearAll("test_reset");

    expect(foregroundSessionState.isBusy()).toBe(false);
    expect(foregroundSessionState.getBusySessions()).toEqual([]);
  });

  it("ignores missing session id or directory", () => {
    foregroundSessionState.markBusy("", "D:/repo");
    foregroundSessionState.markBusy("session-1", "");

    expect(foregroundSessionState.isBusy()).toBe(false);
  });
});
