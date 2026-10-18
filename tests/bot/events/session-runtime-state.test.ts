import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolInfo } from "../../../src/app/managers/summary-aggregation-manager.js";
import type { SessionTargetPolicy } from "../../../src/bot/events/telegram-event-delivery.js";

vi.mock("../../../src/app/services/busy-reconciliation-service.js", () => ({
  setResponseStreamerForReconciliation: vi.fn(),
}));

const streamingMode = vi.hoisted(() => ({ value: "edit" as "edit" | "draft" }));

vi.mock("../../../src/app/stores/settings-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/stores/settings-store.js")>()),
  getResponseStreamingMode: () => streamingMode.value,
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

  describe("background operations", () => {
    function addBackground(sessionId: string): void {
      runtime.runningToolTracker.track(sessionId, "call-bg", true);
      runtime.setRunningToolInfo({ ...toolInfo(sessionId), callId: "call-bg" });
      runtime.setSubagentSnapshot(sessionId, [
        { cardId: "card-bg", background: true, status: "running" },
        { cardId: "card-fg", status: "running" },
      ] as never);
    }

    it("keeps them through a turn boundary and drops the rest of the turn", () => {
      addBackground("session-1");

      runtime.clearToolTracking("session-1", "test", true);

      expect(runtime.runningToolTracker.backgroundCallIds("session-1")).toEqual(["call-bg"]);
      expect(runtime.getRunningToolInfo("session-1", "call-bg")).toBeDefined();
      expect(runtime.getRunningToolInfo("session-1", "call-1")).toBeUndefined();
      expect(runtime.getSubagentSnapshot("session-1")?.map((card) => card.cardId)).toEqual([
        "card-bg",
      ]);
    });

    it("drops them on any other clear", () => {
      addBackground("session-1");

      runtime.clearToolTracking("session-1", "test");

      expect(runtime.runningToolTracker.backgroundCallIds("session-1")).toEqual([]);
      expect(runtime.getRunningToolInfo("session-1", "call-bg")).toBeUndefined();
      expect(runtime.getSubagentSnapshot("session-1")).toBeUndefined();
    });

    it("stops them in one session and leaves the other session running", () => {
      addBackground("session-1");
      runtime.runningToolTracker.track("session-2", "call-bg-2", true);

      runtime.stopBackgroundOperations("test", "session-1");

      expect(runtime.runningToolTracker.backgroundCallIds()).toEqual(["call-bg-2"]);
      expect(runtime.getRunningToolInfo("session-1", "call-bg")).toBeUndefined();
      expect(runtime.getSubagentSnapshot("session-1")?.map((card) => card.cardId)).toEqual([
        "card-fg",
      ]);
    });

    it("stops only the background commands and keeps following the subagent cards", () => {
      addBackground("session-1");

      runtime.stopBackgroundCommands("test", "session-1");

      expect(runtime.runningToolTracker.backgroundCallIds("session-1")).toEqual([]);
      expect(runtime.getRunningToolInfo("session-1", "call-bg")).toBeUndefined();
      expect(runtime.getSubagentSnapshot("session-1")?.map((card) => card.cardId)).toEqual([
        "card-bg",
        "card-fg",
      ]);
    });

    it("counts the background commands of one session, leaving subagent calls to their cards", () => {
      addBackground("session-1");
      runtime.runningToolTracker.track("session-1", "call-task", true);
      runtime.setRunningToolInfo({ ...toolInfo("session-1"), callId: "call-task", tool: "task" });
      runtime.runningToolTracker.track("session-2", "call-bg-2", true);

      expect(runtime.countBackgroundCommands("session-1")).toBe(1);
    });
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

describe("bot/events/session-runtime-state text sent early", () => {
  let runtime: SessionRuntimeState;

  function streamText(messageId: string, text: string): void {
    runtime.recordAssistantText("session-1", messageId, text);
    runtime.enqueueAssistantResponse("session-1", messageId, {
      parts: [{ blocks: [], fallbackText: text, source: "plain" }],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    streamingMode.value = "draft";
    runtime = createRuntime();
  });

  afterEach(() => {
    runtime.reset("test_cleanup");
    streamingMode.value = "edit";
    vi.useRealTimers();
  });

  it("selects only draft replies with text that was not sent yet", () => {
    streamText("message-1", "Analysis");
    streamingMode.value = "edit";
    streamText("message-2", "Edited reply");

    expect(runtime.getUndeliveredAssistantDrafts("session-1")).toEqual([
      { messageId: "message-1", text: "Analysis" },
    ]);
    expect(runtime.getUndeliveredAssistantDrafts("session-2")).toEqual([]);

    runtime.markAssistantTextDelivered("session-1", "message-1", "Analysis");
    expect(runtime.getUndeliveredAssistantDrafts("session-1")).toEqual([]);

    runtime.recordAssistantText("session-1", "message-1", "Analysis\n\nMore");
    expect(runtime.getUndeliveredAssistantDrafts("session-1")).toEqual([
      { messageId: "message-1", text: "Analysis\n\nMore" },
    ]);
  });

  it("strips the text sent early and keeps a reply that no longer extends it whole", () => {
    runtime.markAssistantTextDelivered("session-1", "message-1", "Analysis");

    expect(runtime.stripDeliveredAssistantText("session-1", "message-1", "Analysis\n\nMore")).toBe(
      "\n\nMore",
    );
    expect(runtime.stripDeliveredAssistantText("session-1", "message-1", "Analysis\n\n")).toBe("");
    expect(runtime.stripDeliveredAssistantText("session-1", "message-1", "Rewritten")).toBe(
      "Rewritten",
    );
    expect(runtime.stripDeliveredAssistantText("session-1", "message-2", "Other")).toBe("Other");
  });

  it("hands back the previous mark so a failed early send can restore it", () => {
    expect(
      runtime.markAssistantTextDelivered("session-1", "message-1", "Analysis"),
    ).toBeUndefined();
    expect(runtime.markAssistantTextDelivered("session-1", "message-1", "Analysis more")).toBe(
      "Analysis",
    );

    runtime.markAssistantTextDelivered("session-1", "message-1", undefined);
    expect(runtime.stripDeliveredAssistantText("session-1", "message-1", "Analysis")).toBe(
      "Analysis",
    );
  });

  it("keeps the records through an early draft completion and drops them at the real one", async () => {
    streamText("message-1", "Analysis");
    runtime.markAssistantTextDelivered("session-1", "message-1", "Analysis");

    await runtime.completeAssistantDraftEarly("session-1", "message-1");
    streamingMode.value = "edit";
    expect(runtime.getAssistantStreamMode("session-1", "message-1")).toBe("draft");
    expect(runtime.stripDeliveredAssistantText("session-1", "message-1", "Analysis")).toBe("");

    await runtime.completeAssistantResponse("session-1", "message-1");
    expect(runtime.stripDeliveredAssistantText("session-1", "message-1", "Analysis")).toBe(
      "Analysis",
    );
  });

  it.each([
    [
      "the reply is cleared",
      (state: SessionRuntimeState) =>
        state.clearAssistantResponse("session-1", "message-1", "test"),
    ],
    [
      "the session is cleared",
      (state: SessionRuntimeState) => state.clearSession("session-1", "test"),
    ],
    ["all output is cleared", (state: SessionRuntimeState) => state.clearAllOutput("test")],
  ])("drops the records when %s", (_label, clear) => {
    streamText("message-1", "Analysis");
    runtime.markAssistantTextDelivered("session-1", "message-1", "Analy");

    clear(runtime);

    expect(runtime.getUndeliveredAssistantDrafts("session-1")).toEqual([]);
    expect(runtime.stripDeliveredAssistantText("session-1", "message-1", "Analysis")).toBe(
      "Analysis",
    );
  });

  describe("reply gate", () => {
    it("lets out only the replies begun when the gate was taken, after the cut", async () => {
      vi.useRealTimers();
      streamingMode.value = "edit";
      const api = {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 10 }),
        sendRichMessage: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("Bad Request: rich"), { error_code: 400 })),
        editMessageText: vi.fn().mockResolvedValue(undefined),
        deleteMessage: vi.fn().mockResolvedValue(true),
      };
      const policy = {
        getDestination: () => ({ api, chatId: 42 }),
        isForegroundSession: () => true,
      } as unknown as SessionTargetPolicy;
      const runtime = new SessionRuntimeState({ policy, getReplyKeyboard: () => undefined });
      let releaseOlderLine: () => void = () => {};
      api.sendMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOlderLine = () => resolve({ message_id: 9 });
          }),
      );

      runtime.toolCallStreamer.append("session-1", "older tool line");
      runtime.enqueueAssistantResponse("session-1", "reply-1", {
        parts: [{ blocks: [], fallbackText: "first reply", source: "plain" }],
      });
      runtime.markReplyBegun("session-1", "reply-1");
      runtime.startReplyCut("session-1");
      const gate = runtime.takeReplyGate("session-1");

      runtime.enqueueAssistantResponse("session-1", "reply-2", {
        parts: [{ blocks: [], fallbackText: "second reply", source: "plain" }],
      });
      runtime.markReplyBegun("session-1", "reply-2");
      const letOut = gate?.();
      await new Promise((resolve) => setImmediate(resolve));
      expect(api.sendMessage).toHaveBeenCalledTimes(1);

      releaseOlderLine();
      await letOut;

      const sentTexts = api.sendMessage.mock.calls.map((call) => String(call[1]));
      expect(sentTexts).toEqual(["older tool line", "first reply"]);
      runtime.clearAllOutput("test_cleanup");
    });

    it("has no gate while no reply has begun", () => {
      const runtime = createRuntime();
      expect(runtime.takeReplyGate("session-1")).toBeUndefined();
    });
  });
});
