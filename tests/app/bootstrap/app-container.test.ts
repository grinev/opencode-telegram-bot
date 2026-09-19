import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  stopEventListening: vi.fn(),
}));

vi.mock("../../../src/opencode/events.js", () => ({
  subscribeToEvents: vi.fn(),
  stopEventListening: mocked.stopEventListening,
}));

import { logger } from "../../../src/utils/logger.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

describe("app/bootstrap/app-container", () => {
  let container: AppContainer;

  beforeEach(() => {
    mocked.stopEventListening.mockReset();
    container = createTestAppContainer();
  });

  afterEach(() => {
    container.cleanupProcess("test_teardown");
  });

  it("builds its own managers", () => {
    const other = createTestAppContainer();

    expect(other.interactionManager).not.toBe(container.interactionManager);
    expect(other.summaryAggregator).not.toBe(container.summaryAggregator);
    expect(other.pinnedMessageManager).not.toBe(container.pinnedMessageManager);
    expect(other.scheduledTaskRuntime).not.toBe(container.scheduledTaskRuntime);
    expect(other.opencodeAutoRestartService).not.toBe(container.opencodeAutoRestartService);
    expect(other.opencodeReadyLifecycle).not.toBe(container.opencodeReadyLifecycle);
  });

  it("opens every stateful interaction on its own interaction slot", () => {
    container.questionManager.startQuestions(
      [{ header: "Q1", question: "Pick one", options: [{ label: "Yes", description: "" }] }],
      "req-1",
    );
    expect(container.interactionManager.getSnapshot()?.kind).toBe("question");
    container.interactionManager.reset("test_reset");

    container.permissionManager.startPermission(
      {
        id: "perm-1",
        sessionID: "session-1",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
      101,
    );
    expect(container.interactionManager.getSnapshot()?.kind).toBe("permission");
    container.interactionManager.reset("test_reset");

    container.renameManager.startWaiting("session-1", "D:/repo", "Old title");
    expect(container.interactionManager.getSnapshot()?.kind).toBe("rename");
    container.interactionManager.reset("test_reset");

    container.taskCreationManager.start(
      "project-1",
      "D:/repo",
      { providerID: "provider", modelID: "model", variant: null },
      "build",
    );
    expect(container.interactionManager.getSnapshot()?.kind).toBe("task");
  });

  it("wires auto-restart to its ready lifecycle and the runtime to its foreground state", () => {
    const autoRestart = container.opencodeAutoRestartService as unknown as {
      opencodeReadyLifecycle: unknown;
    };
    const runtime = container.scheduledTaskRuntime as unknown as { foregroundSessionState: unknown };

    expect(autoRestart.opencodeReadyLifecycle).toBe(container.opencodeReadyLifecycle);
    expect(runtime.foregroundSessionState).toBe(container.foregroundSessionState);
  });

  it("keeps one heartbeat and stops it on process cleanup", async () => {
    vi.useFakeTimers();
    const debugSpy = vi.spyOn(logger, "debug");

    container.startHeartbeat();
    container.startHeartbeat();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(debugSpy.mock.calls.filter(([line]) => String(line).includes("Heartbeat"))).toHaveLength(1);

    container.cleanupProcess("test_shutdown");
    expect(vi.getTimerCount()).toBe(0);

    debugSpy.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(debugSpy.mock.calls.filter(([line]) => String(line).includes("Heartbeat"))).toHaveLength(0);
  });

  it("replaces the ready-restore handler and drops it on process cleanup", async () => {
    const first = vi.fn();
    const second = vi.fn();

    container.setReadyRestoreHandler(first);
    container.setReadyRestoreHandler(second);
    await container.opencodeReadyLifecycle.notifyReady("test_ready");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("test_ready");

    container.cleanupProcess("test_shutdown");
    container.opencodeReadyLifecycle.notifyUnavailable("test_down");
    await container.opencodeReadyLifecycle.notifyReady("test_ready_again");

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops event listening and clears runtime state on process cleanup", () => {
    const aggregatorClear = vi.spyOn(container.summaryAggregator, "clear");
    const runClear = vi.spyOn(container.assistantRunState, "clearAll");

    container.cleanupProcess("test_shutdown");

    expect(mocked.stopEventListening).toHaveBeenCalledTimes(1);
    expect(aggregatorClear).toHaveBeenCalledTimes(1);
    expect(runClear).toHaveBeenCalledWith("test_shutdown");
  });

  it("drops the open interaction on the interactions reset", () => {
    container.questionManager.startQuestions(
      [{ header: "Q1", question: "Pick one", options: [{ label: "Yes", description: "" }] }],
      "req-1",
    );
    expect(container.interactionManager.getSnapshot()?.kind).toBe("question");

    container.resetInteractions("test_reset");

    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("drops only the interaction of the failed scope on the interaction-error reset", () => {
    container.questionManager.startQuestions(
      [{ header: "Q1", question: "Pick one", options: [{ label: "Yes", description: "" }] }],
      "req-1",
    );

    container.resetInteractionError("permission", "test_error");
    expect(container.interactionManager.getSnapshot()?.kind).toBe("question");

    container.resetInteractionError("question", "test_error");
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("clears only the aggregator on the aggregator reset", () => {
    const aggregatorClear = vi.spyOn(container.summaryAggregator, "clear");
    const runClear = vi.spyOn(container.assistantRunState, "clearAll");

    container.resetAggregator();

    expect(aggregatorClear).toHaveBeenCalledTimes(1);
    expect(runClear).not.toHaveBeenCalled();
  });

  it("clears run and background state without stopping listening on the runtime-streams reset", () => {
    const runClear = vi.spyOn(container.assistantRunState, "clearAll");
    const trackerClear = vi.spyOn(container.backgroundSessionTracker, "clear");

    container.resetRuntimeStreams("test_reset");

    expect(runClear).toHaveBeenCalledWith("test_reset");
    expect(trackerClear).toHaveBeenCalledTimes(1);
    expect(mocked.stopEventListening).not.toHaveBeenCalled();
  });
});
