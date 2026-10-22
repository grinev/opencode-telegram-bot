import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import type { Event } from "@opencode-ai/sdk/v2";
import { setRuntimeMode } from "../../../src/runtime/mode.js";
import { resetSingletonState } from "../../helpers/reset-singleton-state.js";
import { t } from "../../../src/i18n/index.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import type { BotEventSubscriptionService } from "../../../src/bot/services/event-subscription-service.js";

const mocked = vi.hoisted(() => ({
  subscribeToEvents: vi.fn(),
  stopEventListening: vi.fn(),
  restorePendingInteractionsAfterReconnect: vi.fn(),
}));

vi.mock("../../../src/opencode/events.js", () => ({
  subscribeToEvents: mocked.subscribeToEvents,
  stopEventListening: mocked.stopEventListening,
}));

vi.mock("../../../src/opencode/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/opencode/client.js")>()),
  opencodeServerVersion: "v2",
}));

vi.mock("../../../src/app/services/attach-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/services/attach-service.js")>()),
  restorePendingInteractionsAfterReconnect: mocked.restorePendingInteractionsAfterReconnect,
}));

type FakeBotApi = {
  sendMessage: ReturnType<typeof vi.fn>;
  sendRichMessage: ReturnType<typeof vi.fn>;
  sendMessageDraft: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  editRichMessage: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  sendDocument: ReturnType<typeof vi.fn>;
};

function createFakeBot(): { bot: Bot<Context>; api: FakeBotApi } {
  const richUnavailable = Object.assign(new Error("Bad Request: rich message unavailable"), {
    error_code: 400,
  });
  const api: FakeBotApi = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    sendRichMessage: vi.fn().mockRejectedValue(richUnavailable),
    sendMessageDraft: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    editRichMessage: vi.fn().mockRejectedValue(richUnavailable),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 101 }),
  };

  return { bot: { api } as unknown as Bot<Context>, api };
}

function collectSentTexts(api: FakeBotApi): string[] {
  return [
    ...api.sendMessage.mock.calls.map((call) => String(call[1])),
    ...api.editMessageText.mock.calls.map((call) => String(call[2])),
  ];
}

function emitTool(
  container: AppContainer,
  tool: string,
  status: "running",
  callId: string,
  input: Record<string, unknown>,
): void {
  container.summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: `part-${callId}`,
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: callId,
        tool,
        state: { status, input, metadata: {}, time: { start: Date.now() - 5_000 } },
      },
    },
  } as unknown as Event);
}

function startSubagent(container: AppContainer, background = false): void {
  const { summaryAggregator } = container;
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "root-task",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: "call-task",
        tool: "task",
        state: {
          status: "running",
          input: { description: "slow sleeper", subagent_type: "general", background },
          metadata: { sessionId: "child-1" },
          time: { start: Date.now() },
        },
      },
    },
  } as unknown as Event);
  summaryAggregator.processEvent({
    type: "session.created",
    properties: {
      info: {
        id: "child-1",
        parentID: "session-1",
        title: "slow sleeper (@general subagent)",
        slug: "child",
        directory: "D:/repo",
        projectID: "p1",
        version: "1",
        time: { created: Date.now(), updated: Date.now() },
      },
    },
  } as unknown as Event);
  summaryAggregator.processEvent({
    type: "message.updated",
    properties: {
      info: {
        id: "child-message-1",
        sessionID: "child-1",
        role: "assistant",
        agent: "general",
        providerID: "openai",
        modelID: "gpt-5.4",
        time: { created: Date.now() },
      },
    },
  } as unknown as Event);
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "child-tool-1",
        sessionID: "child-1",
        messageID: "child-message-1",
        type: "tool",
        callID: "child-call-1",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "sleep 40" },
          metadata: {},
          time: { start: Date.now() },
        },
      },
    },
  } as unknown as Event);
}

function lastCardText(api: FakeBotApi): string {
  return collectSentTexts(api).filter((text) => text.includes("🧩")).at(-1) ?? "";
}

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(6_000);
  }
}

describe("bot/services/event-subscription-service lost run", () => {
  let tempHome = "";
  let service: BotEventSubscriptionService | null = null;
  let container: AppContainer;
  let api: FakeBotApi;

  beforeEach(async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", await mkdtemp(path.join(os.tmpdir(), "lost-run-")));
    tempHome = process.env.OPENCODE_TELEGRAM_HOME!;
    setRuntimeMode("installed");

    mocked.subscribeToEvents.mockReset().mockResolvedValue(undefined);
    mocked.restorePendingInteractionsAfterReconnect.mockReset().mockResolvedValue(undefined);

    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
    await resetSingletonState();

    const [{ createEventSubscriptionService }, sessionService] = await Promise.all([
      import("../../../src/bot/services/event-subscription-service.js"),
      import("../../../src/app/services/session-service.js"),
    ]);
    sessionService.setCurrentSession({ id: "session-1", title: "Test", directory: "D:/repo" });
    settingsStore.setCompactOutputMode(false);
    settingsStore.setShowAssistantRunFooter(true);

    const fake = createFakeBot();
    api = fake.api;
    container = createTestAppContainer();
    service = createEventSubscriptionService(container);
    service.clearRuntimeState("test_setup");
    container.assistantRunState.startRun("session-1", {
      startedAt: Date.now() - 1000,
      configuredAgent: "build",
      configuredProviderID: "test-provider",
      configuredModelID: "test-model",
    });
    service.setTelegramContext(fake.bot, 42);
    await service.ensureEventSubscription("D:/repo");
    container.summaryAggregator.setSession("session-1");
    container.summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: { id: "message-1", sessionID: "session-1", role: "assistant", time: { created: 1 } },
      },
    } as unknown as Event);

    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 20));
    service?.cleanup("test_cleanup");
    service = null;
    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
    vi.unstubAllEnvs();
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it("ends the running line as after /abort, with no footer and the run cleared", async () => {
    emitTool(container, "bash", "running", "call-bash", { command: "npm test" });
    await settle();

    const ending = service!.endRunLostWithServer("opencode_stop");
    await settle();
    await ending;

    const texts = collectSentTexts(api);
    const last = texts.filter((text) => text.includes("npm test")).at(-1) ?? "";
    expect(last).not.toContain("⏳");
    expect(texts.some((text) => text.includes("🧠"))).toBe(false);
    expect(container.assistantRunState.hasRun("session-1")).toBe(false);

    const sentBefore = collectSentTexts(api).length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collectSentTexts(api)).toHaveLength(sentBefore);
  });

  it("finishes ending the lines before it resolves, so a reset right after loses nothing", async () => {
    emitTool(container, "bash", "running", "call-bash", { command: "npm test" });
    await settle();

    // /opencode_stop resets runtime streams as soon as the ending resolves.
    const ending = service!.endRunLostWithServer("opencode_stop").then(() => {
      service!.clearRuntimeState("opencode_stop");
    });
    await settle();
    await ending;

    const last = collectSentTexts(api).filter((text) => text.includes("npm test")).at(-1) ?? "";
    expect(last).not.toContain("⏳");
  });

  it("releases the ending hold when the ending throws", async () => {
    const aggregator = container.summaryAggregator;
    const interruptSpy = vi.spyOn(aggregator, "interruptSubagents").mockImplementation(() => {
      throw new Error("interrupt failed");
    });

    try {
      const ending = service!.endRunLostWithServer("opencode_stop");

      await expect(ending).rejects.toThrow("interrupt failed");
      await expect(aggregator.whenOutboundIdle()).resolves.toBeUndefined();
    } finally {
      interruptSpy.mockRestore();
    }
  });

  it("stays pending when a newer hold takes over the ending queue", async () => {
    emitTool(container, "bash", "running", "call-bash", { command: "npm test" });
    await settle();

    const aggregator = container.summaryAggregator;
    const ending = service!.endRunLostWithServer("opencode_stop");
    const newerGeneration = aggregator.holdOutbound();

    let settled = false;
    void ending.then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);

    const draining = aggregator.drainOutbound(0, newerGeneration);
    await settle();
    await draining;
    await ending;
    expect(settled).toBe(true);

    const last = collectSentTexts(api).filter((text) => text.includes("npm test")).at(-1) ?? "";
    expect(last).not.toContain("⏳");
  });

  it("closes the poll on screen as not answered instead of deleting it", async () => {
    emitTool(container, "question", "running", "call-question", {});
    await settle();
    container.questionManager.startQuestions(
      [{ question: "Red or blue?", header: "Color", options: [{ label: "Red", description: "" }] }],
      "form-1",
      "session-1",
    );
    container.questionManager.addMessageId(700);
    container.questionManager.setActiveMessageId(700);

    const ending = service!.endRunLostWithServer("opencode_restarted");
    await settle();
    await ending;

    expect(api.deleteMessage).not.toHaveBeenCalledWith(42, 700);
    const pollEdit = api.editMessageText.mock.calls.find((call) => call[1] === 700);
    expect(JSON.stringify(pollEdit)).toContain(t("question.not_answered"));
    expect(container.questionManager.isActive()).toBe(false);
  });

  it("ends a running subagent card interrupted, timed to when the server went away", async () => {
    startSubagent(container);
    await settle();
    expect(lastCardText(api)).toContain("sleep 40");

    const ending = service!.endRunLostWithServer("opencode_restarted");
    await settle();
    await ending;

    expect(lastCardText(api).split("\n").at(-1)).toMatch(/^⏹ Interrupted · 🕒 \d+s$/);
    const sentBefore = collectSentTexts(api).length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(collectSentTexts(api)).toHaveLength(sentBefore);
  });

  it("ends a background subagent card interrupted even when the session holds no run", async () => {
    startSubagent(container, true);
    await settle();
    container.summaryAggregator.processEvent({
      type: "session.idle",
      properties: { sessionID: "session-1" },
    } as unknown as Event);
    await settle();
    container.assistantRunState.clearRun("session-1", "test");
    expect(lastCardText(api)).toContain("sleep 40");

    const ending = service!.endRunLostWithServer("opencode_restarted");
    await settle();
    await ending;

    expect(lastCardText(api).split("\n").at(-1)).toMatch(/^⏹ Interrupted · 🕒 \d+m/);
  });

  it("does nothing to the chat when nothing of the session runs", async () => {
    container.assistantRunState.clearRun("session-1", "test");
    const sentBefore = collectSentTexts(api).length;

    const ending = service!.endRunLostWithServer("opencode_restarted");
    await settle();
    await ending;

    expect(collectSentTexts(api)).toHaveLength(sentBefore);
  });

  it("ends the lost run on a reconnect to a restarted server, then restores with the mark", async () => {
    emitTool(container, "bash", "running", "call-bash", { command: "npm test" });
    await settle();
    const onReconnect = mocked.subscribeToEvents.mock.calls.at(-1)?.[2] as (info: {
      serverRestarted: boolean | null;
    }) => void;

    onReconnect({ serverRestarted: true });
    await settle();

    expect(container.assistantRunState.hasRun("session-1")).toBe(false);
    expect(mocked.restorePendingInteractionsAfterReconnect).toHaveBeenCalledWith(
      expect.anything(),
      true,
    );
  });

  it("keeps the run on a reconnect to the same server", async () => {
    const onReconnect = mocked.subscribeToEvents.mock.calls.at(-1)?.[2] as (info: {
      serverRestarted: boolean | null;
    }) => void;

    onReconnect({ serverRestarted: false });
    await settle();

    expect(container.assistantRunState.hasRun("session-1")).toBe(true);
    expect(mocked.restorePendingInteractionsAfterReconnect).toHaveBeenCalledWith(
      expect.anything(),
      false,
    );
  });
});
