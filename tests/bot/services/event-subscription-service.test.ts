import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import type { Event } from "@opencode-ai/sdk/v2";
import { setRuntimeMode } from "../../../src/runtime/mode.js";
import { resetSingletonState } from "../../helpers/reset-singleton-state.js";
import { defined } from "../../helpers/defined.js";

const mocked = vi.hoisted(() => ({
  subscribeToEvents: vi.fn(),
  stopEventListening: vi.fn(),
}));

vi.mock("../../../src/opencode/all-events.js", () => ({
  subscribeToAllSessionEvents: vi.fn(async () => {}),
  stopAllSessionEvents: vi.fn(),
}));

vi.mock("../../../src/opencode/events.js", () => ({
  subscribeToEvents: mocked.subscribeToEvents,
  stopEventListening: mocked.stopEventListening,
}));

type FakeBotApi = {
  sendMessage: ReturnType<typeof vi.fn>;
  sendRichMessage: ReturnType<typeof vi.fn>;
  sendMessageDraft: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  sendDocument: ReturnType<typeof vi.fn>;
};

function createFakeBot(): { bot: Bot<Context>; api: FakeBotApi } {
  const api: FakeBotApi = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    sendRichMessage: vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Bad Request: rich message unavailable"), { error_code: 400 })),
    sendMessageDraft: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 101 }),
  };

  return { bot: { api } as unknown as Bot<Context>, api };
}

function emitAssistantMessage(
  summaryAggregator: { processEvent(event: Event): void },
  messageId = "message-1",
): void {
  summaryAggregator.processEvent({
    type: "message.updated",
    properties: {
      info: {
        id: messageId,
        sessionID: "session-1",
        role: "assistant",
        time: { created: Date.now() },
      },
    },
  } as unknown as Event);
}

function emitWriteTool(summaryAggregator: { processEvent(event: Event): void }): void {
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: "call-write",
        tool: "write",
        state: {
          status: "completed",
          input: {
            filePath: "src/file.ts",
            content: "const value = 1;\n",
          },
          metadata: {},
        },
      },
    },
  } as unknown as Event);
}

function emitThinkingPart(
  summaryAggregator: { processEvent(event: Event): void },
  text: string,
  messageId = "message-1",
): void {
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: `reasoning-${messageId}`,
        sessionID: "session-1",
        messageID: messageId,
        type: "reasoning",
        text,
      },
    },
  } as unknown as Event);
}

function emitAssistantTextPart(
  summaryAggregator: { processEvent(event: Event): void },
  text: string,
): void {
  summaryAggregator.processEvent({
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

function emitAssistantCompleted(summaryAggregator: { processEvent(event: Event): void }): void {
  summaryAggregator.processEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "message-1",
        sessionID: "session-1",
        role: "assistant",
        agent: "test-agent",
        providerID: "test-provider",
        modelID: "test-model",
        time: { created: Date.now() - 1000, completed: Date.now() },
      },
    },
  } as unknown as Event);
}

function emitSessionIdle(summaryAggregator: { processEvent(event: Event): void }): void {
  summaryAggregator.processEvent({
    type: "session.idle",
    properties: { sessionID: "session-1" },
  } as unknown as Event);
}

function emitPermissionAsked(
  summaryAggregator: { processEvent(event: Event): void },
  requestID: string,
  patterns: string[] = ["D:/shared/*"],
): void {
  summaryAggregator.processEvent({
    type: "permission.asked",
    properties: {
      id: requestID,
      sessionID: "session-1",
      permission: "external_directory",
      patterns,
      metadata: {},
      always: ["D:/shared/*"],
    },
  } as unknown as Event);
}

function emitBashTool(
  summaryAggregator: { processEvent(event: Event): void },
  status: "running" | "completed" | "error",
  options: { callId?: string; command?: string } = {},
): void {
  const callId = options.callId ?? "call-bash";
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: `part-${callId}`,
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: callId,
        tool: "bash",
        state: {
          status,
          input: { command: options.command ?? "npm test" },
          metadata: {},
          ...(status === "completed" ? { output: "ok" } : {}),
          ...(status === "error" ? { error: "command failed" } : {}),
        },
      },
    },
  } as unknown as Event);
}

function emitReadTool(
  summaryAggregator: { processEvent(event: Event): void },
  status: "running" | "completed" | "error",
  options: { callId: string; filePath: string },
): void {
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: `part-${options.callId}`,
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: options.callId,
        tool: "read",
        state: {
          status,
          input: { filePath: options.filePath },
          metadata: {},
          ...(status === "completed" ? { output: "ok" } : {}),
          ...(status === "error" ? { error: "read failed" } : {}),
        },
      },
    },
  } as unknown as Event);
}

function emitBareTool(
  summaryAggregator: { processEvent(event: Event): void },
  status: "running" | "completed" | "error",
  callId: string,
): void {
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: `part-${callId}`,
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: callId,
        tool: "unknown_tool",
        state: {
          status,
          input: {},
          metadata: {},
          ...(status === "completed" ? { output: "ok" } : {}),
          ...(status === "error" ? { error: "failed" } : {}),
        },
      },
    },
  } as unknown as Event);
}

function emitTaskTool(
  summaryAggregator: { processEvent(event: Event): void },
  options: { callId?: string; status?: "running" | "completed" | "error" } = {},
): void {
  const callId = options.callId ?? "call-task";
  const status = options.status ?? "running";
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: `part-${callId}`,
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: callId,
        tool: "task",
        state: {
          status,
          input: {
            description: "Explore the project",
            subagent_type: "explore",
            prompt: "Inspect architecture",
          },
          metadata: {},
          ...(status === "completed" ? { output: "ok" } : {}),
          ...(status === "error" ? { error: "task failed" } : {}),
        },
      },
    },
  } as unknown as Event);
}

function emitSubagentStart(
  summaryAggregator: { processEvent(event: Event): void },
  suffix = "1",
): void {
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: `subtask-${suffix}`,
        sessionID: "session-1",
        messageID: "message-1",
        type: "subtask",
        prompt: `Inspect the project ${suffix}`,
        description: `inspect task ${suffix}`,
        agent: "explore",
      },
    },
  } as unknown as Event);

  summaryAggregator.processEvent({
    type: "session.created",
    properties: {
      info: {
        id: `child-session-${suffix}`,
        parentID: "session-1",
        title: `inspect task ${suffix} (@explore subagent)`,
        slug: `child-${suffix}`,
        directory: "D:/repo",
        projectID: "p1",
        version: "1",
        time: { created: Date.now(), updated: Date.now() },
      },
    },
  } as unknown as Event);
}

function emitSubagentTool(summaryAggregator: { processEvent(event: Event): void }): void {
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "child-tool-1",
        sessionID: "child-session-1",
        messageID: "child-message-1",
        type: "tool",
        callID: "call-child-bash",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "npm run lint" },
          metadata: {},
        },
      },
    },
  } as unknown as Event);
}

/**
 * Stream flushes start at 1s and can grow during a run. These numbers stay well
 * above the first throttle step so fake-timer helpers do not race the flush.
 *
 * ELAPSED_SETTLE_MS keeps the fake clock inside the same 20-30s display bucket,
 * so the asserted text stays "20s" no matter how long the flush took.
 */
const STREAM_FLUSH_MS = 6000;
const ELAPSED_SETTLE_MS = 29_000;

/**
 * The aggregator dispatches its callbacks through setImmediate, so that one is
 * deliberately left real - only the clock and the timers the tracker and the
 * streamers rely on are faked.
 */
function useTrackerFakeTimers(): void {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
}

/**
 * Lets the aggregator's setImmediate dispatch run and then flushes the faked
 * streamer timers it scheduled.
 */
async function flushPendingDispatch(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(STREAM_FLUSH_MS);
  }
}

function collectSentTexts(api: FakeBotApi): string[] {
  return [
    ...api.sendMessage.mock.calls.map((call) => String(call[1])),
    ...api.editMessageText.mock.calls.map((call) => String(call[2])),
  ];
}

function emitPermissionReplied(
  summaryAggregator: { processEvent(event: Event): void },
  requestID: string,
): void {
  summaryAggregator.processEvent({
    type: "permission.replied",
    properties: {
      sessionID: "session-1",
      requestID,
      reply: "always",
    },
  } as unknown as Event);
}

describe("bot/services/event-subscription-service", () => {
  let tempHome: string;
  let activeService: { cleanup(reason: string): void } | null = null;

  beforeEach(async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", await mkdtemp(path.join(os.tmpdir(), "event-service-")));
    tempHome = process.env.OPENCODE_TELEGRAM_HOME!;
    setRuntimeMode("installed");

    mocked.subscribeToEvents.mockReset();
    mocked.stopEventListening.mockReset();
    mocked.subscribeToEvents.mockResolvedValue(undefined);

    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
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
    // Settings writes can still be landing on Windows when the temp home is
    // removed, so retry instead of failing the test in teardown.
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function setupService(
    sendDiffFileAttachments: boolean,
    options: {
      responseStreamingMode?: "edit" | "draft";
      showThinkingContent?: boolean;
      showAssistantRunFooter?: boolean;
      startAssistantRun?: boolean;
    } = {},
  ): Promise<{
    api: FakeBotApi;
    summaryAggregator: { setSession(sessionId: string): void; processEvent(event: Event): void };
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
    settingsStore.setSendDiffFileAttachments(sendDiffFileAttachments);
    settingsStore.setResponseStreamingMode(options.responseStreamingMode ?? "edit");
    settingsStore.setShowThinkingContent(options.showThinkingContent ?? true);
    settingsStore.setShowAssistantRunFooter(options.showAssistantRunFooter ?? true);

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

    return { api, summaryAggregator };
  }

  it("sends write tool output as a document attachment when diff files are enabled", async () => {
    const { api, summaryAggregator } = await setupService(true);

    emitWriteTool(summaryAggregator);

    await vi.waitFor(() => {
      expect(api.sendDocument).toHaveBeenCalledTimes(1);
    });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("streams write tool call text without document attachment when diff files are disabled", async () => {
    const { api, summaryAggregator } = await setupService(false);

    emitWriteTool(summaryAggregator);
    emitSessionIdle(summaryAggregator);

    await vi.waitFor(
      () => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );
    expect(defined(api.sendMessage.mock.calls[0]?.[1])).toContain("write");
    expect(api.sendDocument).not.toHaveBeenCalled();
  });

  describe("elapsed time for long tool calls", () => {
    it("shows a live line once the call passes the threshold", async () => {
      const { api, summaryAggregator } = await setupService(false);

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running");
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);

      const texts = collectSentTexts(api);
      expect(texts.some((text) => text.includes("⏳") && text.includes("· 🕒 20s"))).toBe(true);
      expect(texts.some((text) => text.includes("npm test"))).toBe(true);
    });

    it("replaces the live line with a final line carrying the total duration", async () => {
      const { api, summaryAggregator } = await setupService(false);

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running");
      await vi.advanceTimersByTimeAsync(25_000);
      emitBashTool(summaryAggregator, "completed");
      await flushPendingDispatch();

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("npm test");
      expect(lastText).toContain("· 🕒 25s");
      expect(lastText).not.toContain("⏳");
    });

    it("leaves fast tool calls exactly as before", async () => {
      const { api, summaryAggregator } = await setupService(false);

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running");
      await vi.advanceTimersByTimeAsync(2000);
      emitBashTool(summaryAggregator, "completed");
      await flushPendingDispatch();

      const texts = collectSentTexts(api);
      expect(texts.some((text) => text.includes("npm test"))).toBe(true);
      expect(texts.some((text) => text.includes("⏳"))).toBe(false);
      expect(texts.some((text) => text.includes("🕒"))).toBe(false);
    });

    it("does not send compact progress after the session goes idle", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running");
      emitSessionIdle(summaryAggregator);
      await flushPendingDispatch();

      expect(collectSentTexts(api).some((text) => text.includes("⏳ Working"))).toBe(false);
    });

    it("adds the duration to the compact progress line", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      // Let the settings write finish before the clock is faked, otherwise it
      // races with the temp home cleanup in afterEach.
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running");
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);

      const texts = collectSentTexts(api);
      expect(texts.some((text) => text.includes("· 🕒 20s"))).toBe(true);
    });

    it("stops the timer when a tool call ends in an error", async () => {
      const { api, summaryAggregator } = await setupService(false);

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running");
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);
      emitBashTool(summaryAggregator, "error");
      await flushPendingDispatch();

      const callsAfterError = collectSentTexts(api).length;
      await vi.advanceTimersByTimeAsync(120_000);

      expect(collectSentTexts(api)).toHaveLength(callsAfterError);
    });

    it("leaves a failed tool call without the running marker but with its duration", async () => {
      const { api, summaryAggregator } = await setupService(false);

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running");
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);
      emitBashTool(summaryAggregator, "error");
      await flushPendingDispatch();

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("npm test");
      // The final line carries the exact duration, not the display bucket.
      expect(lastText).toContain("· 🕒 29s");
      expect(lastText).not.toContain("⏳");
    });

    it("stops tracking a session that goes idle after it stopped being current", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const sessionService = await import("../../../src/app/services/session-service.js");

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running");
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);
      const callsBefore = collectSentTexts(api).length;

      sessionService.setCurrentSession({
        id: "session-2",
        title: "Other session",
        directory: "D:/repo",
      });
      emitSessionIdle(summaryAggregator);
      await flushPendingDispatch();

      // Coming back makes the tick pass its current-session check again, so a
      // tracker entry that survived the idle would resume editing the message.
      sessionService.setCurrentSession({
        id: "session-1",
        title: "Test session",
        directory: "D:/repo",
      });
      await vi.advanceTimersByTimeAsync(120_000);

      expect(collectSentTexts(api)).toHaveLength(callsBefore);
    });

    it("times the task tool in compact mode, where no subagent card exists", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitTaskTool(summaryAggregator);
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);

      const texts = collectSentTexts(api);
      expect(texts.some((text) => text.includes("Running Task") && text.includes("· 🕒 20s"))).toBe(
        true,
      );
    });

    it("falls back to the still-running bash after parallel reads finish in compact mode", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "README.md" });
      emitReadTool(summaryAggregator, "completed", { callId: "call-read-1", filePath: "README.md" });
      emitReadTool(summaryAggregator, "running", { callId: "call-read-2", filePath: "AGENTS.md" });
      emitReadTool(summaryAggregator, "completed", { callId: "call-read-2", filePath: "AGENTS.md" });
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("sleep 90");
      expect(lastText).toContain("· 🕒 20s");
      expect(lastText).not.toContain("AGENTS.md");
      expect(lastText).not.toContain("README.md");
    });

    it("lets a new compact tool take the line and returns to the remaining one with its timer", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "AGENTS.md" });
      await flushPendingDispatch();

      expect(collectSentTexts(api).pop() ?? "").toContain("AGENTS.md");

      emitReadTool(summaryAggregator, "completed", { callId: "call-read-1", filePath: "AGENTS.md" });
      await flushPendingDispatch();

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("sleep 90");
      expect(lastText).toMatch(/· 🕒 \d+[ms]/);
      expect(lastText).not.toContain("AGENTS.md");
    });

    it("shows the most recently started still-running tool in compact mode", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      await flushPendingDispatch();
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "AGENTS.md" });
      await flushPendingDispatch();

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("AGENTS.md");
      expect(lastText).not.toContain("sleep 90");
    });

    it("leaves the finished tool on the compact line once nothing is still running", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "AGENTS.md" });
      emitReadTool(summaryAggregator, "completed", { callId: "call-read-1", filePath: "AGENTS.md" });
      emitBashTool(summaryAggregator, "completed", { command: "sleep 90" });
      await flushPendingDispatch();

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("sleep 90");
      expect(lastText).not.toContain("🕒");
    });

    it("treats an error sibling like a finish and falls back to the still-running tool", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "AGENTS.md" });
      emitReadTool(summaryAggregator, "error", { callId: "call-read-1", filePath: "AGENTS.md" });
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("sleep 90");
      expect(lastText).toContain("· 🕒 20s");
      expect(lastText).not.toContain("AGENTS.md");
    });

    it("applies the same compact fallback when a task tool runs beside bash", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      emitTaskTool(summaryAggregator);
      await flushPendingDispatch();
      expect(collectSentTexts(api).pop() ?? "").toContain("Running Task");

      emitTaskTool(summaryAggregator, { status: "completed" });
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("sleep 90");
      expect(lastText).toMatch(/· 🕒 \d+[ms]/);
    });

    it("keeps the running compact tool on the line when thinking or writing arrives", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      await flushPendingDispatch();
      emitThinkingPart(summaryAggregator, "planning");
      await flushPendingDispatch();
      emitAssistantTextPart(summaryAggregator, "Here is the answer");
      await flushPendingDispatch();

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("sleep 90");
      expect(lastText).not.toContain("Thinking");
      expect(lastText).not.toContain("Writing answer");
    });

    it("shows a detail-less running sibling instead of a finished compact tool", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "AGENTS.md" });
      emitBareTool(summaryAggregator, "running", "call-bare");
      emitReadTool(summaryAggregator, "completed", { callId: "call-read-1", filePath: "AGENTS.md" });
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("unknown_tool");
      expect(lastText).toContain("· 🕒 20s");
      expect(lastText).not.toContain("AGENTS.md");
    });

    it("does not leave a finished compact tool on the line when only a detail-less sibling remains", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "AGENTS.md" });
      emitBareTool(summaryAggregator, "running", "call-bare");
      emitReadTool(summaryAggregator, "completed", { callId: "call-read-1", filePath: "AGENTS.md" });
      await vi.advanceTimersByTimeAsync(ELAPSED_SETTLE_MS);

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).not.toContain("AGENTS.md");
      expect(lastText).toContain("unknown_tool");
      expect(lastText).toContain("· 🕒 20s");
    });

    it("does not let an older compact tool steal the line on a later running update", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      await flushPendingDispatch();
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "AGENTS.md" });
      await flushPendingDispatch();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      await flushPendingDispatch();

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("AGENTS.md");
      expect(lastText).not.toContain("sleep 90");
    });

    it("shows the existing duration bucket when falling back after ten minutes", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitBashTool(summaryAggregator, "running", { command: "sleep 90" });
      await vi.advanceTimersByTimeAsync(12 * 60_000);
      emitReadTool(summaryAggregator, "running", { callId: "call-read-1", filePath: "AGENTS.md" });
      emitReadTool(summaryAggregator, "completed", { callId: "call-read-1", filePath: "AGENTS.md" });
      await flushPendingDispatch();

      const lastText = collectSentTexts(api).pop() ?? "";
      expect(lastText).toContain("sleep 90");
      expect(lastText).toContain("· 🕒 10m");
      expect(lastText).not.toContain("12m");
      expect(lastText).not.toContain("AGENTS.md");
    });

    it("keeps subagent cards ticking without any incoming events", async () => {
      const { api, summaryAggregator } = await setupService(false);

      useTrackerFakeTimers();
      emitSubagentStart(summaryAggregator);
      emitSubagentTool(summaryAggregator);
      await flushPendingDispatch();
      await vi.advanceTimersByTimeAsync(25_000);

      const texts = collectSentTexts(api);
      expect(texts.some((text) => text.includes("npm run lint") && /· 🕒 \d+s/.test(text))).toBe(
        true,
      );
    });

    it("sends overlapping subagents as independent card messages", async () => {
      const { api, summaryAggregator } = await setupService(false);

      useTrackerFakeTimers();
      emitSubagentStart(summaryAggregator, "1");
      emitSubagentStart(summaryAggregator, "2");
      await flushPendingDispatch();

      const cardMessages = api.sendMessage.mock.calls
        .map((call) => String(call[1]))
        .filter((text) => text.includes("🧩"));

      expect(cardMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining("inspect task 1"),
          expect.stringContaining("inspect task 2"),
        ]),
      );
      expect(cardMessages.every((text) => !(text.includes("inspect task 1") && text.includes("inspect task 2")))).toBe(
        true,
      );
    });
  });

  describe("compact progress at the start of work", () => {
    it("shows thinking on the progress message before any tool runs", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitThinkingPart(summaryAggregator, "planning");
      await flushPendingDispatch();

      const texts = collectSentTexts(api);
      expect(texts.some((text) => text.includes("💭 Thinking..."))).toBe(true);
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("shows writing on the progress message when the model writes first", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitAssistantTextPart(summaryAggregator, "Here is the answer");
      await flushPendingDispatch();

      expect(collectSentTexts(api).some((text) => text.includes("✍️ Writing answer..."))).toBe(true);
    });

    it("reuses the thinking message for a later tool and then writing", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitThinkingPart(summaryAggregator, "planning");
      await flushPendingDispatch();
      emitBashTool(summaryAggregator, "running");
      await flushPendingDispatch();
      emitAssistantTextPart(summaryAggregator, "not yet");
      await flushPendingDispatch();

      expect(collectSentTexts(api).some((text) => text.includes("✍️ Writing answer..."))).toBe(false);
      expect(collectSentTexts(api).pop() ?? "").toContain("npm test");

      emitBashTool(summaryAggregator, "completed");
      await flushPendingDispatch();
      emitAssistantTextPart(summaryAggregator, "Here is the answer");
      await flushPendingDispatch();

      const progressSends = api.sendMessage.mock.calls.filter((call) =>
        String(call[1]).includes("⏳ Working"),
      );
      expect(progressSends).toHaveLength(1);
      expect(collectSentTexts(api).some((text) => text.includes("✍️ Writing answer..."))).toBe(true);
    });

    it("deletes the progress message on idle when delete on finish is on", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      settingsStore.setDeleteCompactProgressOnFinish(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitThinkingPart(summaryAggregator, "planning");
      await flushPendingDispatch();
      emitSessionIdle(summaryAggregator);
      await flushPendingDispatch();

      expect(api.deleteMessage).toHaveBeenCalled();
    });

    it("finalizes a second run while the first card is still being finalized", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      let nextMessageId = 100;
      api.sendMessage.mockImplementation(async () => ({ message_id: nextMessageId++ }));

      let releaseFirstEdit: (() => void) | undefined;
      api.editMessageText.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstEdit = () => resolve(undefined);
          }),
      );

      useTrackerFakeTimers();
      emitThinkingPart(summaryAggregator, "run-a");
      await flushPendingDispatch();
      emitSessionIdle(summaryAggregator);
      await flushPendingDispatch();

      emitAssistantMessage(summaryAggregator, "message-2");
      emitThinkingPart(summaryAggregator, "run-b", "message-2");
      await flushPendingDispatch();
      emitSessionIdle(summaryAggregator);
      await flushPendingDispatch();

      expect(api.editMessageText).toHaveBeenCalledTimes(2);
      expect(
        api.editMessageText.mock.calls.every((call) => String(call[2]).includes("✅ Finished Work")),
      ).toBe(true);

      releaseFirstEdit?.();
    });

    it("edits the progress message to the finished summary on idle when delete on finish is off", async () => {
      const { api, summaryAggregator } = await setupService(false);
      const settingsStore = await import("../../../src/app/stores/settings-store.js");
      settingsStore.setCompactOutputMode(true);
      await new Promise((resolve) => setTimeout(resolve, 50));

      useTrackerFakeTimers();
      emitThinkingPart(summaryAggregator, "planning");
      await flushPendingDispatch();
      emitSessionIdle(summaryAggregator);
      await flushPendingDispatch();

      expect(collectSentTexts(api).some((text) => text.includes("✅ Finished Work"))).toBe(true);
    });
  });

  it("uses edit streaming for visible thinking content when assistant responses use draft mode", async () => {
    const { api, summaryAggregator } = await setupService(true, {
      responseStreamingMode: "draft",
      showThinkingContent: true,
    });

    emitThinkingPart(summaryAggregator, "First thought");

    // First stream flush is 1s; keep the wait well above that.
    await vi.waitFor(
      () => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      },
      { timeout: 10_000 },
    );

    emitThinkingPart(summaryAggregator, "First thought\nSecond thought");

    await vi.waitFor(
      () => {
        expect(api.editMessageText).toHaveBeenCalledTimes(1);
      },
      { timeout: 10_000 },
    );
    expect(api.sendMessageDraft).not.toHaveBeenCalled();
  }, 30_000);

  it("keeps hidden thinking as a separate non-draft message", async () => {
    const { api, summaryAggregator } = await setupService(true, {
      responseStreamingMode: "draft",
      showThinkingContent: false,
    });

    emitThinkingPart(summaryAggregator, "Hidden thought");

    await vi.waitFor(
      () => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      },
      { timeout: 10_000 },
    );
    expect(api.editMessageText).not.toHaveBeenCalled();
    expect(api.sendMessageDraft).not.toHaveBeenCalled();
  }, 30_000);

  it("does not send assistant run footer when it is disabled", async () => {
    const { api, summaryAggregator } = await setupService(true, {
      responseStreamingMode: "edit",
      showAssistantRunFooter: false,
      startAssistantRun: true,
    });

    emitAssistantTextPart(summaryAggregator, "Final answer");
    emitAssistantCompleted(summaryAggregator);
    emitSessionIdle(summaryAggregator);

    await vi.waitFor(
      () => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );
    expect(defined(api.sendMessage.mock.calls[0]?.[1])).toBe("Final answer");
  });

  it("notifies the final draft response when assistant run footer is disabled", async () => {
    const { api, summaryAggregator } = await setupService(true, {
      responseStreamingMode: "draft",
      showAssistantRunFooter: false,
      startAssistantRun: true,
    });

    emitAssistantTextPart(summaryAggregator, "Final answer");
    emitAssistantCompleted(summaryAggregator);
    emitSessionIdle(summaryAggregator);

    await vi.waitFor(
      () => {
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );
    expect(defined(api.sendMessage.mock.calls[0]?.[1])).toBe("Final answer");
    expect(defined(api.sendMessage.mock.calls[0])[2]?.disable_notification).toBeUndefined();
    expect(api.sendMessageDraft).not.toHaveBeenCalled();
  });

  it("keeps the final draft response silent when assistant run footer is enabled", async () => {
    const { api, summaryAggregator } = await setupService(true, {
      responseStreamingMode: "draft",
      showAssistantRunFooter: true,
      startAssistantRun: true,
    });

    emitAssistantTextPart(summaryAggregator, "Final answer");
    emitAssistantCompleted(summaryAggregator);
    emitSessionIdle(summaryAggregator);

    await vi.waitFor(
      () => {
        expect(api.sendMessage).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );
    expect(defined(api.sendMessage.mock.calls[0]?.[1])).toBe("Final answer");
    expect(defined(api.sendMessage.mock.calls[0])[2]).toEqual({ disable_notification: true });
    expect(defined(api.sendMessage.mock.calls[1]?.[1])).toContain("test-provider/test-model");
    expect(api.sendMessageDraft).not.toHaveBeenCalled();
  });

  it("clears permission prompts when OpenCode resolves pending requests", async () => {
    const { api, summaryAggregator } = await setupService(true);
    const [{ permissionManager }, { interactionManager }] = await Promise.all([
      import("../../../src/app/managers/permission-manager.js"),
      import("../../../src/app/managers/interaction-manager.js"),
    ]);
    api.sendMessage
      .mockResolvedValueOnce({ message_id: 500 })
      .mockResolvedValueOnce({ message_id: 501 });

    emitPermissionAsked(summaryAggregator, "permission-1");
    emitPermissionAsked(summaryAggregator, "permission-2", ["D:/other/*"]);

    await vi.waitFor(() => {
      expect(permissionManager.getPendingCount()).toBe(2);
    });

    emitPermissionReplied(summaryAggregator, "permission-2");

    await vi.waitFor(() => {
      expect(permissionManager.getPendingCount()).toBe(1);
    });
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 501);
    expect(permissionManager.getRequestID(500)).toBe("permission-1");
    expect(interactionManager.getSnapshot()?.metadata.pendingCount).toBe(1);

    emitPermissionReplied(summaryAggregator, "permission-1");

    await vi.waitFor(() => {
      expect(permissionManager.isActive()).toBe(false);
      expect(interactionManager.getSnapshot()).toBeNull();
    });
    expect(api.deleteMessage).toHaveBeenCalledWith(42, 500);
  });

  it("discards a permission prompt resolved while its Telegram message is being sent", async () => {
    const { api, summaryAggregator } = await setupService(true);
    const [{ permissionManager }, { interactionManager }] = await Promise.all([
      import("../../../src/app/managers/permission-manager.js"),
      import("../../../src/app/managers/interaction-manager.js"),
    ]);
    let resolveSend: (message: { message_id: number }) => void = () => {};
    const pendingSend = new Promise<{ message_id: number }>((resolve) => {
      resolveSend = resolve;
    });
    api.sendMessage.mockReturnValueOnce(pendingSend);

    emitPermissionAsked(summaryAggregator, "permission-race");
    await vi.waitFor(() => {
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });

    emitPermissionReplied(summaryAggregator, "permission-race");
    await vi.waitFor(() => {
      expect(permissionManager.isResolved("permission-race")).toBe(true);
    });

    resolveSend({ message_id: 502 });

    await vi.waitFor(() => {
      expect(api.deleteMessage).toHaveBeenCalledWith(42, 502);
    });
    expect(permissionManager.isActive()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("does not replace a newer interaction when a permission is resolved", async () => {
    const { api, summaryAggregator } = await setupService(true);
    const [{ permissionManager }, { interactionManager }] = await Promise.all([
      import("../../../src/app/managers/permission-manager.js"),
      import("../../../src/app/managers/interaction-manager.js"),
    ]);
    api.sendMessage
      .mockResolvedValueOnce({ message_id: 510 })
      .mockResolvedValueOnce({ message_id: 511 });
    emitPermissionAsked(summaryAggregator, "permission-1");
    emitPermissionAsked(summaryAggregator, "permission-2", ["D:/other/*"]);
    await vi.waitFor(() => {
      expect(permissionManager.getPendingCount()).toBe(2);
    });
    interactionManager.start({ kind: "rename", expectedInput: "text" });

    emitPermissionReplied(summaryAggregator, "permission-2");

    await vi.waitFor(() => {
      expect(permissionManager.getPendingCount()).toBe(1);
    });
    expect(interactionManager.getSnapshot()?.kind).toBe("rename");
  });
});
