import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  stopEventListening: vi.fn(),
}));

vi.mock("../../../src/opencode/events.js", () => ({
  subscribeToEvents: vi.fn(),
  stopEventListening: mocked.stopEventListening,
}));

import { assistantRunState } from "../../../src/app/managers/assistant-run-state-manager.js";
import { backgroundSessionTracker } from "../../../src/app/managers/background-session-manager.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { questionManager } from "../../../src/app/managers/question-manager.js";
import { summaryAggregator } from "../../../src/app/managers/summary-aggregation-manager.js";
import { scheduledTaskRuntime } from "../../../src/app/services/scheduled-task-runtime-service.js";
import { pinnedMessageManager } from "../../../src/bot/pinned/pinned-message-manager.js";
import { opencodeAutoRestartService } from "../../../src/opencode/auto-restart.js";
import { opencodeReadyLifecycle } from "../../../src/opencode/ready-lifecycle.js";
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
    opencodeReadyLifecycle.__resetForTests();
  });

  it("holds the module instances", () => {
    expect(container.interactionManager).toBe(interactionManager);
    expect(container.summaryAggregator).toBe(summaryAggregator);
    expect(container.pinnedMessageManager).toBe(pinnedMessageManager);
    expect(container.scheduledTaskRuntime).toBe(scheduledTaskRuntime);
    expect(container.opencodeAutoRestartService).toBe(opencodeAutoRestartService);
    expect(container.opencodeReadyLifecycle).toBe(opencodeReadyLifecycle);
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
    await opencodeReadyLifecycle.notifyReady("test_ready");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("test_ready");

    container.cleanupProcess("test_shutdown");
    opencodeReadyLifecycle.notifyUnavailable("test_down");
    await opencodeReadyLifecycle.notifyReady("test_ready_again");

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops event listening and clears runtime state on process cleanup", () => {
    const aggregatorClear = vi.spyOn(summaryAggregator, "clear");
    const runClear = vi.spyOn(assistantRunState, "clearAll");

    container.cleanupProcess("test_shutdown");

    expect(mocked.stopEventListening).toHaveBeenCalledTimes(1);
    expect(aggregatorClear).toHaveBeenCalledTimes(1);
    expect(runClear).toHaveBeenCalledWith("test_shutdown");
  });

  it("drops the open interaction on the interactions reset", () => {
    questionManager.startQuestions(
      [{ header: "Q1", question: "Pick one", options: [{ label: "Yes", description: "" }] }],
      "req-1",
    );
    expect(interactionManager.getSnapshot()?.kind).toBe("question");

    container.resetInteractions("test_reset");

    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("drops only the interaction of the failed scope on the interaction-error reset", () => {
    questionManager.startQuestions(
      [{ header: "Q1", question: "Pick one", options: [{ label: "Yes", description: "" }] }],
      "req-1",
    );

    container.resetInteractionError("permission", "test_error");
    expect(interactionManager.getSnapshot()?.kind).toBe("question");

    container.resetInteractionError("question", "test_error");
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("clears only the aggregator on the aggregator reset", () => {
    const aggregatorClear = vi.spyOn(summaryAggregator, "clear");
    const runClear = vi.spyOn(assistantRunState, "clearAll");

    container.resetAggregator();

    expect(aggregatorClear).toHaveBeenCalledTimes(1);
    expect(runClear).not.toHaveBeenCalled();
  });

  it("clears run and background state without stopping listening on the runtime-streams reset", () => {
    const runClear = vi.spyOn(assistantRunState, "clearAll");
    const trackerClear = vi.spyOn(backgroundSessionTracker, "clear");

    container.resetRuntimeStreams("test_reset");

    expect(runClear).toHaveBeenCalledWith("test_reset");
    expect(trackerClear).toHaveBeenCalledTimes(1);
    expect(mocked.stopEventListening).not.toHaveBeenCalled();
  });
});
