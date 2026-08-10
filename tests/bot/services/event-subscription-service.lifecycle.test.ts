import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import type { Event } from "@opencode-ai/sdk/v2";
import { setRuntimeMode } from "../../../src/runtime/mode.js";
import { resetSingletonState } from "../../helpers/reset-singleton-state.js";

const mocked = vi.hoisted(() => ({
  subscribeToEvents: vi.fn(),
  stopEventListening: vi.fn(),
  reconcileBusyState: vi.fn(),
  reconciliationStreamer: {
    current: null as { hasActiveStream(sessionId: string): boolean } | null,
  },
}));

vi.mock("../../../src/opencode/events.js", () => ({
  subscribeToEvents: mocked.subscribeToEvents,
  stopEventListening: mocked.stopEventListening,
}));

/**
 * The service registers its response streamers with the busy reconciliation
 * service on construction. Capturing that registration is the only public way
 * to ask whether a session still has a live assistant stream.
 */
vi.mock("../../../src/app/services/busy-reconciliation-service.js", () => ({
  reconcileBusyState: mocked.reconcileBusyState,
  setResponseStreamerForReconciliation: (streamer: {
    hasActiveStream(sessionId: string): boolean;
  }) => {
    mocked.reconciliationStreamer.current = streamer;
  },
  setPromptResponseModeClearerForReconciliation: () => {},
}));

type FakeBotApi = {
  sendMessage: ReturnType<typeof vi.fn>;
  sendMessageDraft: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  sendDocument: ReturnType<typeof vi.fn>;
};

type Aggregator = { setSession(sessionId: string): void; processEvent(event: Event): void };

function createFakeBot(): { bot: Bot<Context>; api: FakeBotApi } {
  const api: FakeBotApi = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    sendMessageDraft: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 101 }),
  };

  return { bot: { api } as unknown as Bot<Context>, api };
}

function emitAssistantMessage(aggregator: Aggregator): void {
  aggregator.processEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "message-1",
        sessionID: "session-1",
        role: "assistant",
        time: { created: Date.now() },
      },
    },
  } as unknown as Event);
}

function emitAssistantTextPart(aggregator: Aggregator, text: string): void {
  aggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "text-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "text",
        text,
      },
    },
  } as unknown as Event);
}

function emitAssistantCompleted(aggregator: Aggregator): void {
  aggregator.processEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "message-1",
        sessionID: "session-1",
        role: "assistant",
        agent: "test-agent",
        providerID: "test-provider",
        modelID: "test-model",
        // The authoritative OpenCode message finish for a successful run.
        finish: "stop",
        time: { created: Date.now() - 1000, completed: Date.now() },
      },
    },
  } as unknown as Event);
}

function emitSessionIdle(aggregator: Aggregator): void {
  aggregator.processEvent({
    type: "session.idle",
    properties: { sessionID: "session-1" },
  } as unknown as Event);
}

function emitBashTool(aggregator: Aggregator, status: "running" | "completed"): void {
  aggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-bash",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: "call-bash",
        tool: "bash",
        state: {
          status,
          input: { command: "npm test" },
          metadata: {},
          ...(status === "completed" ? { output: "ok" } : {}),
        },
      },
    },
  } as unknown as Event);
}

function countTelegramWrites(api: FakeBotApi): number {
  return (
    api.sendMessage.mock.calls.length +
    api.sendMessageDraft.mock.calls.length +
    api.editMessageText.mock.calls.length
  );
}

function collectSentTexts(api: FakeBotApi): string[] {
  return [
    ...api.sendMessage.mock.calls.map((call) => String(call[1])),
    ...api.editMessageText.mock.calls.map((call) => String(call[2])),
  ];
}

function findFooterCalls(api: FakeBotApi): unknown[][] {
  return api.sendMessage.mock.calls.filter((call) =>
    String(call[1]).includes("test-provider/test-model"),
  );
}

/**
 * Lets the aggregator's setImmediate dispatch and the callbacks it triggers
 * run to completion. Anything that has to cross the stream throttle waits with
 * vi.waitFor instead: RESPONSE_STREAM_THROTTLE_MS is read at module load,
 * before beforeEach can stub it, so its value is not known here.
 */
async function settle(iterations = 4): Promise<void> {
  for (let attempt = 0; attempt < iterations; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

const STREAM_WAIT_TIMEOUT_MS = 10_000;

function hasActiveStream(sessionId: string): boolean {
  return mocked.reconciliationStreamer.current?.hasActiveStream(sessionId) ?? false;
}

/** The raw SSE handler the service passed to subscribeToEvents. */
function getEventDispatcher(): (event: unknown) => void {
  const subscription = mocked.subscribeToEvents.mock.calls.at(-1);
  if (!subscription) {
    throw new Error("subscribeToEvents was never called");
  }

  return subscription[1] as (event: unknown) => void;
}

function emitExternalUserMessage(aggregator: Aggregator, text: string): void {
  aggregator.processEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "user-message-1",
        sessionID: "session-1",
        role: "user",
        time: { created: Date.now() },
      },
    },
  } as unknown as Event);

  aggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "user-text-1",
        sessionID: "session-1",
        messageID: "user-message-1",
        type: "text",
        text,
      },
    },
  } as unknown as Event);
}

function emitSessionError(aggregator: Aggregator, message: string): void {
  aggregator.processEvent({
    type: "session.error",
    properties: { sessionID: "session-1", error: { message } },
  } as unknown as Event);
}

describe("bot/services/event-subscription-service lifecycle", () => {
  let tempHome: string;
  let activeService: { cleanup(reason: string): void } | null = null;

  beforeEach(async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("RESPONSE_STREAM_THROTTLE_MS", "1");
    vi.stubEnv(
      "OPENCODE_TELEGRAM_HOME",
      await mkdtemp(path.join(os.tmpdir(), "event-service-lifecycle-")),
    );
    tempHome = process.env.OPENCODE_TELEGRAM_HOME!;
    setRuntimeMode("installed");

    mocked.subscribeToEvents.mockReset();
    mocked.stopEventListening.mockReset();
    mocked.reconcileBusyState.mockReset();
    mocked.subscribeToEvents.mockResolvedValue(undefined);
    mocked.reconciliationStreamer.current = null;

    const [
      settingsStore,
      { foregroundSessionState },
      { assistantRunState },
      { attachManager },
      abortSuppression,
      { externalUserInputSuppressionManager },
    ] = await Promise.all([
      import("../../../src/app/stores/settings-store.js"),
      import("../../../src/app/managers/foreground-session-state-manager.js"),
      import("../../../src/app/managers/assistant-run-state-manager.js"),
      import("../../../src/app/managers/attach-manager.js"),
      import("../../../src/app/managers/abort-suppression-manager.js"),
      import("../../../src/app/managers/external-input-suppression-manager.js"),
    ]);
    settingsStore.__resetSettingsForTests();
    foregroundSessionState.__resetForTests();
    assistantRunState.__resetForTests();
    attachManager.__resetForTests();
    abortSuppression.__resetUserAbortErrorSuppressionForTests();
    externalUserInputSuppressionManager.__resetForTests();
    await resetSingletonState();
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Settings writes scheduled while timers were faked need a real tick to
    // land before the temp home is removed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeService?.cleanup("test_cleanup");
    activeService = null;

    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
    vi.unstubAllEnvs();
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function setupService(
    options: {
      responseStreamingMode?: "edit" | "draft";
      showAssistantRunFooter?: boolean;
      startAssistantRun?: boolean;
    } = {},
  ): Promise<{
    api: FakeBotApi;
    summaryAggregator: Aggregator;
    service: {
      setTelegramContext(bot: Bot<Context> | null, chatId: number | null): void;
      clearRuntimeState(reason: string): void;
      cleanup(reason: string): void;
    };
  }> {
    const [
      { createEventSubscriptionService },
      { summaryAggregator },
      sessionService,
      settingsStore,
      { assistantRunState },
    ] = await Promise.all([
      import("../../../src/bot/services/event-subscription-service.js"),
      import("../../../src/app/managers/summary-aggregation-manager.js"),
      import("../../../src/app/services/session-service.js"),
      import("../../../src/app/stores/settings-store.js"),
      import("../../../src/app/managers/assistant-run-state-manager.js"),
    ]);

    sessionService.setCurrentSession({
      id: "session-1",
      title: "Test session",
      directory: "D:/repo",
    });
    settingsStore.setCompactOutputMode(false);
    settingsStore.setSendDiffFileAttachments(false);
    settingsStore.setResponseStreamingMode(options.responseStreamingMode ?? "edit");
    settingsStore.setShowThinkingContent(true);
    settingsStore.setShowAssistantRunFooter(options.showAssistantRunFooter ?? false);

    const { bot, api } = createFakeBot();
    const service = createEventSubscriptionService();
    activeService = service;
    service.clearRuntimeState("test_setup");
    if (options.startAssistantRun) {
      assistantRunState.startRun("session-1", {
        startedAt: Date.now() - 1000,
        configuredAgent: "test-agent",
        configuredProviderID: "test-provider",
        configuredModelID: "test-model",
      });
    }
    service.setTelegramContext(bot, 42);
    await service.ensureEventSubscription("D:/repo");
    summaryAggregator.setSession("session-1");
    emitAssistantMessage(summaryAggregator);

    return { api, summaryAggregator, service };
  }

  describe("assistant completion without a usable target", () => {
    it("clears the run and idles the session when the Telegram context is gone", async () => {
      const { api, summaryAggregator, service } = await setupService({ startAssistantRun: true });
      const [{ foregroundSessionState }, { assistantRunState }] = await Promise.all([
        import("../../../src/app/managers/foreground-session-state-manager.js"),
        import("../../../src/app/managers/assistant-run-state-manager.js"),
      ]);
      foregroundSessionState.markBusy("session-1", "D:/repo");

      emitAssistantTextPart(summaryAggregator, "Answer");
      await settle();
      expect(hasActiveStream("session-1")).toBe(true);
      const writesBefore = countTelegramWrites(api);

      service.setTelegramContext(null, null);
      emitAssistantCompleted(summaryAggregator);
      await vi.waitFor(
        () => {
          expect(foregroundSessionState.isBusy()).toBe(false);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      expect(countTelegramWrites(api)).toBe(writesBefore);
      expect(hasActiveStream("session-1")).toBe(false);
      expect(assistantRunState.finishRun("session-1", "assertion")).toBeNull();
    });

    it("drops the response when the session changed while the agent was answering", async () => {
      const { api, summaryAggregator } = await setupService({ startAssistantRun: true });
      const [
        sessionService,
        { foregroundSessionState },
        { assistantRunState },
        { scheduledTaskRuntime },
      ] = await Promise.all([
        import("../../../src/app/services/session-service.js"),
        import("../../../src/app/managers/foreground-session-state-manager.js"),
        import("../../../src/app/managers/assistant-run-state-manager.js"),
        import("../../../src/app/services/scheduled-task-runtime-service.js"),
      ]);
      foregroundSessionState.markBusy("session-1", "D:/repo");
      const flushSpy = vi.spyOn(scheduledTaskRuntime, "flushDeferredDeliveries");

      emitAssistantTextPart(summaryAggregator, "Answer");
      await settle();
      const writesBefore = countTelegramWrites(api);

      sessionService.setCurrentSession({
        id: "session-2",
        title: "Other session",
        directory: "D:/repo",
      });
      emitAssistantCompleted(summaryAggregator);
      await vi.waitFor(
        () => {
          expect(foregroundSessionState.isBusy()).toBe(false);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      expect(countTelegramWrites(api)).toBe(writesBefore);
      expect(hasActiveStream("session-1")).toBe(false);
      expect(assistantRunState.finishRun("session-1", "assertion")).toBeNull();
      expect(flushSpy).toHaveBeenCalled();
    });
  });

  describe("session idle ordering", () => {
    it("holds the run footer until the pending completion task finishes", async () => {
      const { api, summaryAggregator } = await setupService({
        startAssistantRun: true,
        showAssistantRunFooter: true,
      });

      let releaseSend: (message: { message_id: number }) => void = () => {};
      api.sendMessage.mockReturnValueOnce(
        new Promise<{ message_id: number }>((resolve) => {
          releaseSend = resolve;
        }),
      );

      emitAssistantTextPart(summaryAggregator, "Answer");
      emitAssistantCompleted(summaryAggregator);
      emitSessionIdle(summaryAggregator);
      await vi.waitFor(
        () => {
          expect(api.sendMessage).toHaveBeenCalled();
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );
      await settle();

      // The gated send proves the completion task is still running; the footer
      // belongs strictly after it.
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      expect(findFooterCalls(api)).toHaveLength(0);

      releaseSend({ message_id: 100 });

      await vi.waitFor(
        () => {
          expect(findFooterCalls(api)).toHaveLength(1);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );
      expect(api.sendMessage.mock.calls.at(-1)?.[1]).toContain("test-provider/test-model");
    }, 30_000);

    it("skips the footer for a session that went idle after losing focus", async () => {
      const { api, summaryAggregator } = await setupService({
        startAssistantRun: true,
        showAssistantRunFooter: true,
      });
      const [sessionService, { foregroundSessionState }] = await Promise.all([
        import("../../../src/app/services/session-service.js"),
        import("../../../src/app/managers/foreground-session-state-manager.js"),
      ]);
      foregroundSessionState.markBusy("session-1", "D:/repo");

      emitAssistantTextPart(summaryAggregator, "Answer");
      emitAssistantCompleted(summaryAggregator);
      await settle();

      sessionService.setCurrentSession({
        id: "session-2",
        title: "Other session",
        directory: "D:/repo",
      });
      emitSessionIdle(summaryAggregator);
      await vi.waitFor(
        () => {
          expect(foregroundSessionState.isBusy()).toBe(false);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      expect(findFooterCalls(api)).toHaveLength(0);
    }, 30_000);
  });

  describe("streaming mode switching", () => {
    it("finishes an answer with the streamer it was started with after a switch to draft", async () => {
      const { api, summaryAggregator } = await setupService({ responseStreamingMode: "edit" });
      const settingsStore = await import("../../../src/app/stores/settings-store.js");

      emitAssistantTextPart(summaryAggregator, "Partial answer");
      await vi.waitFor(
        () => {
          expect(api.sendMessage).toHaveBeenCalledTimes(1);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      settingsStore.setResponseStreamingMode("draft");
      emitAssistantTextPart(summaryAggregator, "Partial answer, now complete");
      emitAssistantCompleted(summaryAggregator);
      await vi.waitFor(
        () => {
          expect(collectSentTexts(api).at(-1)).toBe("Partial answer, now complete");
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      expect(api.sendMessageDraft).not.toHaveBeenCalled();
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    }, 30_000);

    it("finishes a draft answer through the draft streamer after a switch to edit", async () => {
      const { api, summaryAggregator } = await setupService({ responseStreamingMode: "draft" });
      const settingsStore = await import("../../../src/app/stores/settings-store.js");

      emitAssistantTextPart(summaryAggregator, "Partial answer");
      await vi.waitFor(
        () => {
          expect(api.sendMessageDraft).toHaveBeenCalled();
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );
      expect(api.sendMessage).not.toHaveBeenCalled();

      settingsStore.setResponseStreamingMode("edit");
      emitAssistantTextPart(summaryAggregator, "Partial answer, now complete");
      emitAssistantCompleted(summaryAggregator);
      await vi.waitFor(
        () => {
          expect(api.sendMessage).toHaveBeenCalledTimes(1);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      // The draft is persisted with a real message, never edited in place.
      expect(api.editMessageText).not.toHaveBeenCalled();
      expect(api.sendMessage.mock.calls[0][1]).toBe("Partial answer, now complete");
    }, 30_000);
  });

  describe("runtime state teardown", () => {
    it("clearRuntimeState drops active assistant streams and runs", async () => {
      const { summaryAggregator, service } = await setupService({ startAssistantRun: true });
      const { assistantRunState } =
        await import("../../../src/app/managers/assistant-run-state-manager.js");

      emitAssistantTextPart(summaryAggregator, "Answer");
      await settle();
      expect(hasActiveStream("session-1")).toBe(true);

      service.clearRuntimeState("test_clear");

      expect(hasActiveStream("session-1")).toBe(false);
      expect(assistantRunState.finishRun("session-1", "assertion")).toBeNull();
    });

    it("clearRuntimeState stops the elapsed-time timers of running tools", async () => {
      const { api, summaryAggregator, service } = await setupService();

      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
      });
      emitBashTool(summaryAggregator, "running");
      await vi.advanceTimersByTimeAsync(29_000);
      const writesBefore = collectSentTexts(api).length;
      expect(writesBefore).toBeGreaterThan(0);

      service.clearRuntimeState("test_clear");
      await vi.advanceTimersByTimeAsync(120_000);

      expect(collectSentTexts(api)).toHaveLength(writesBefore);
    });

    it("cleanup stops event listening and detaches the Telegram context", async () => {
      const { api, summaryAggregator, service } = await setupService();

      emitBashTool(summaryAggregator, "completed");
      await vi.waitFor(
        () => {
          expect(countTelegramWrites(api)).toBeGreaterThan(0);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );
      const writesBefore = countTelegramWrites(api);
      mocked.stopEventListening.mockClear();

      service.cleanup("test_cleanup");

      expect(mocked.stopEventListening).toHaveBeenCalledTimes(1);

      // The aggregator lost its session with the cleanup, so replaying the same
      // stream cannot reach Telegram anymore.
      emitAssistantMessage(summaryAggregator);
      emitAssistantTextPart(summaryAggregator, "Answer");
      emitBashTool(summaryAggregator, "completed");
      await settle();

      expect(countTelegramWrites(api)).toBe(writesBefore);
    }, 30_000);
  });

  describe("raw event routing", () => {
    const busyEvents: Record<string, unknown>[] = [
      {
        type: "message.updated",
        properties: { info: { id: "m-9", sessionID: "session-9", role: "assistant", time: {} } },
      },
      { type: "message.part.updated", properties: { part: { sessionID: "session-9" } } },
      { type: "message.part.delta", properties: { sessionID: "session-9" } },
      { type: "question.asked", properties: { sessionID: "session-9" } },
      { type: "permission.asked", properties: { sessionID: "session-9" } },
      { type: "session.status", properties: { sessionID: "session-9", status: { type: "busy" } } },
    ];

    const idleEvents: Record<string, unknown>[] = [
      {
        type: "message.updated",
        properties: {
          info: { id: "m-9", sessionID: "session-9", role: "assistant", time: { completed: 2 } },
        },
      },
      { type: "session.idle", properties: { sessionID: "session-9" } },
      { type: "session.status", properties: { sessionID: "session-9", status: { type: "idle" } } },
    ];

    it("reconciles busy state on every server heartbeat", async () => {
      await setupService();

      getEventDispatcher()({ type: "server.heartbeat", properties: {} });

      expect(mocked.reconcileBusyState).toHaveBeenCalledWith("D:/repo");
    });

    it("marks the attached session busy while the agent is working", async () => {
      await setupService();
      const { attachManager } = await import("../../../src/app/managers/attach-manager.js");
      const dispatch = getEventDispatcher();

      for (const event of busyEvents) {
        attachManager.attach("session-9", "D:/repo");
        dispatch(event);
        await settle(1);

        expect(attachManager.isBusy(), `event ${event.type} should mark busy`).toBe(true);
      }
    });

    it("leaves the attached session idle for events that report no work", async () => {
      await setupService();
      const { attachManager } = await import("../../../src/app/managers/attach-manager.js");
      const dispatch = getEventDispatcher();

      for (const event of idleEvents) {
        attachManager.attach("session-9", "D:/repo");
        dispatch(event);
        await settle(1);

        expect(attachManager.isBusy(), `event ${event.type} should not mark busy`).toBe(false);
      }
    });

    it("ignores progress events belonging to another session", async () => {
      await setupService();
      const { attachManager } = await import("../../../src/app/managers/attach-manager.js");
      attachManager.attach("session-9", "D:/repo");

      getEventDispatcher()({
        type: "message.part.updated",
        properties: { part: { sessionID: "session-other" } },
      });
      await settle(1);

      expect(attachManager.isBusy()).toBe(false);
    });

    it("announces a background session that finished answering", async () => {
      const { api } = await setupService();
      const dispatch = getEventDispatcher();

      dispatch({
        type: "session.created",
        properties: { info: { id: "session-9", title: "Background work" } },
      });
      dispatch({
        type: "message.updated",
        properties: {
          info: { id: "m-9", sessionID: "session-9", role: "assistant", time: { completed: 2 } },
        },
      });
      dispatch({ type: "session.idle", properties: { sessionID: "session-9" } });

      await vi.waitFor(() => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      });
      expect(api.sendMessage.mock.calls[0][1]).toContain("Background work");
      expect(api.sendMessage.mock.calls[0][2]).toHaveProperty("reply_markup");
    });

    it("labels an untitled background session by its shortened id", async () => {
      const { api } = await setupService();
      const dispatch = getEventDispatcher();

      dispatch({
        type: "message.updated",
        properties: {
          info: {
            id: "m-9",
            sessionID: "bg-session-123456",
            role: "assistant",
            time: { completed: 2 },
          },
        },
      });
      dispatch({ type: "session.idle", properties: { sessionID: "bg-session-123456" } });

      await vi.waitFor(() => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      });
      expect(api.sendMessage.mock.calls[0][1]).toContain("bg-sessi");
      expect(api.sendMessage.mock.calls[0][1]).not.toContain("bg-session-123456");
    });
  });

  describe("session errors and retries", () => {
    it("reports the session error and releases the run", async () => {
      const { api, summaryAggregator } = await setupService({ startAssistantRun: true });
      const [{ foregroundSessionState }, { assistantRunState }] = await Promise.all([
        import("../../../src/app/managers/foreground-session-state-manager.js"),
        import("../../../src/app/managers/assistant-run-state-manager.js"),
      ]);
      foregroundSessionState.markBusy("session-1", "D:/repo");

      emitSessionError(summaryAggregator, "provider exploded");

      await vi.waitFor(() => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      });
      expect(api.sendMessage.mock.calls[0][1]).toContain("provider exploded");
      expect(foregroundSessionState.isBusy()).toBe(false);
      expect(assistantRunState.finishRun("session-1", "assertion")).toBeNull();
    });

    it("stays silent for the error that follows a user-requested abort", async () => {
      const { api, summaryAggregator } = await setupService();
      const [{ markUserAbortRequested }, { foregroundSessionState }] = await Promise.all([
        import("../../../src/app/managers/abort-suppression-manager.js"),
        import("../../../src/app/managers/foreground-session-state-manager.js"),
      ]);
      foregroundSessionState.markBusy("session-1", "D:/repo");
      markUserAbortRequested("session-1");

      emitSessionError(summaryAggregator, "Aborted");

      await vi.waitFor(() => {
        expect(foregroundSessionState.isBusy()).toBe(false);
      });
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it("truncates an oversized session error", async () => {
      const { api, summaryAggregator } = await setupService();

      emitSessionError(summaryAggregator, "x".repeat(5000));

      await vi.waitFor(() => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      });
      const text = String(api.sendMessage.mock.calls[0][1]);
      expect(text).toContain("...");
      expect(text.length).toBeLessThan(3700);
    });

    it("streams a retry notice while the provider is backing off", async () => {
      const { api, summaryAggregator } = await setupService();

      summaryAggregator.processEvent({
        type: "session.status",
        properties: {
          sessionID: "session-1",
          status: { type: "retry", attempt: 2, message: "rate limited", next: Date.now() + 1000 },
        },
      } as unknown as Event);

      await vi.waitFor(
        () => {
          expect(collectSentTexts(api).some((text) => text.includes("rate limited"))).toBe(true);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );
    }, 30_000);

    it("releases the session when the final answer cannot be delivered", async () => {
      const { api, summaryAggregator } = await setupService({ startAssistantRun: true });
      const [{ foregroundSessionState }, { assistantRunState }] = await Promise.all([
        import("../../../src/app/managers/foreground-session-state-manager.js"),
        import("../../../src/app/managers/assistant-run-state-manager.js"),
      ]);
      foregroundSessionState.markBusy("session-1", "D:/repo");
      api.sendMessage.mockRejectedValue(new Error("telegram unreachable"));
      api.editMessageText.mockRejectedValue(new Error("telegram unreachable"));

      emitAssistantTextPart(summaryAggregator, "Answer");
      emitAssistantCompleted(summaryAggregator);

      await vi.waitFor(
        () => {
          expect(foregroundSessionState.isBusy()).toBe(false);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );
      expect(assistantRunState.finishRun("session-1", "assertion")).toBeNull();
    }, 30_000);
  });

  describe("assistant stream resilience", () => {
    it("keeps streaming after Telegram reports an edit as unmodified", async () => {
      const { api, summaryAggregator } = await setupService({ responseStreamingMode: "edit" });

      emitAssistantTextPart(summaryAggregator, "Answer");
      await vi.waitFor(
        () => {
          expect(api.sendMessage).toHaveBeenCalledTimes(1);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      api.editMessageText.mockRejectedValueOnce(new Error("Bad Request: message is not modified"));
      emitAssistantTextPart(summaryAggregator, "Answer with more");
      await vi.waitFor(
        () => {
          expect(api.editMessageText).toHaveBeenCalledTimes(1);
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      emitAssistantTextPart(summaryAggregator, "Answer with even more");
      emitAssistantCompleted(summaryAggregator);
      await vi.waitFor(
        () => {
          expect(collectSentTexts(api).at(-1)).toBe("Answer with even more");
        },
        { timeout: STREAM_WAIT_TIMEOUT_MS },
      );

      // A broken stream would be torn down and resent as a fresh message.
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      expect(api.deleteMessage).not.toHaveBeenCalled();
    }, 30_000);

    it("notifies the user about input typed outside Telegram", async () => {
      const { api, summaryAggregator } = await setupService();

      emitExternalUserMessage(summaryAggregator, "typed in the terminal");

      await vi.waitFor(() => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      });
      expect(String(api.sendMessage.mock.calls[0][1])).toContain("typed in the terminal");
    });

    it("stays silent about input the bot itself sent", async () => {
      const { api, summaryAggregator } = await setupService();
      const { externalUserInputSuppressionManager } =
        await import("../../../src/app/managers/external-input-suppression-manager.js");
      externalUserInputSuppressionManager.register("session-1", "sent from Telegram");

      emitExternalUserMessage(summaryAggregator, "sent from Telegram");
      await settle();

      expect(api.sendMessage).not.toHaveBeenCalled();
    });
  });
});
