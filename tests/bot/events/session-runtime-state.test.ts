import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolInfo } from "../../../src/app/managers/summary-aggregation-manager.js";
import type { SessionTargetPolicy } from "../../../src/bot/events/telegram-event-delivery.js";

vi.mock("../../../src/app/services/busy-reconciliation-service.js", () => ({
  setResponseStreamerForReconciliation: vi.fn(),
}));

import { SessionRuntimeState } from "../../../src/bot/events/session-runtime-state.js";

const SESSIONS = ["session-1", "session-2"] as const;

function createRuntime(): SessionRuntimeState {
  const api = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 10 }),
    sendRichMessage: vi.fn().mockResolvedValue({ message_id: 11 }),
    sendMessageDraft: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(true),
  };
  const policy = {
    getDestination: () => ({ api, chatId: 42 }),
    isForegroundSession: () => true,
  } as unknown as SessionTargetPolicy;

  return new SessionRuntimeState({ policy, getReplyKeyboard: () => undefined });
}

function toolInfo(sessionId: string): ToolInfo {
  return {
    sessionId,
    messageId: "message-1",
    callId: "call-1",
    tool: "bash",
    state: { status: "running" },
    input: {},
    hasFileAttachment: false,
  } as unknown as ToolInfo;
}

/** Puts one of everything the runtime keeps into a session. */
function fillSession(runtime: SessionRuntimeState, sessionId: string): void {
  runtime.enqueueAssistantResponse(sessionId, "message-1", {
    parts: [{ blocks: [], fallbackText: "partial", source: "plain" }],
  });
  runtime.setThinkingSections(sessionId, "message-1", []);
  runtime.setRunningToolInfo(toolInfo(sessionId));
  runtime.runningToolTracker.track(sessionId, `${sessionId}-call`);
  runtime.setCompletedToolDuration(sessionId, "call-0", 1500);
  runtime.setCompactActivity(sessionId, { callId: "call-1", activity: "Running" });
  runtime.setSubagentSnapshot(sessionId, []);
  void runtime.enqueueCompletionTask(sessionId, () => new Promise<void>(() => {}));
}

function describeSession(runtime: SessionRuntimeState, sessionId: string) {
  return {
    activeResponse: runtime.hasActiveAssistantResponse(sessionId),
    thinking: runtime.getThinkingSections(sessionId, "message-1") !== undefined,
    runningTool: runtime.getRunningToolInfo(sessionId, "call-1") !== undefined,
    trackedCalls: Array.from(runtime.runningToolTracker.trackedCallIds(sessionId)).length,
    compactActivity: runtime.getCompactActivity(sessionId) !== undefined,
    subagents: runtime.getSubagentSnapshot(sessionId) !== undefined,
    completionTask: runtime.getCompletionTask(sessionId) !== undefined,
  };
}

const FILLED = {
  activeResponse: true,
  thinking: true,
  runningTool: true,
  trackedCalls: 1,
  compactActivity: true,
  subagents: true,
  completionTask: true,
};

const EMPTY = {
  activeResponse: false,
  thinking: false,
  runningTool: false,
  trackedCalls: 0,
  compactActivity: false,
  subagents: false,
  completionTask: false,
};

describe("bot/events/session-runtime-state", () => {
  let runtime: SessionRuntimeState;

  beforeEach(() => {
    vi.useFakeTimers();
    runtime = createRuntime();
    for (const sessionId of SESSIONS) {
      fillSession(runtime, sessionId);
    }
  });

  afterEach(() => {
    runtime.reset("test_cleanup");
    vi.useRealTimers();
  });

  it("clears one session without touching another", () => {
    runtime.clearSession("session-1", "test");

    expect(describeSession(runtime, "session-1")).toEqual(EMPTY);
    expect(describeSession(runtime, "session-2")).toEqual(FILLED);
    expect(runtime.takeCompletedToolDuration("session-1", "call-0")).toBeUndefined();
    expect(runtime.takeCompletedToolDuration("session-2", "call-0")).toBe(1500);
  });

  it("keeps a session's entries apart from a same-named call in another session", () => {
    runtime.deleteRunningToolInfo("session-1", "call-1");

    expect(runtime.getRunningToolInfo("session-1", "call-1")).toBeUndefined();
    expect(runtime.getRunningToolInfo("session-2", "call-1")?.sessionId).toBe("session-2");
  });

  it("drops all output but keeps queued completion work when output is cleared", () => {
    runtime.clearAllOutput("test");

    for (const sessionId of SESSIONS) {
      expect(describeSession(runtime, sessionId)).toEqual({ ...EMPTY, completionTask: true });
    }
  });

  it("clears every session on a full reset", () => {
    runtime.reset("test");

    for (const sessionId of SESSIONS) {
      expect(describeSession(runtime, sessionId)).toEqual(EMPTY);
    }
  });
});
