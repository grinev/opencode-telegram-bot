import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import type { Event } from "@opencode-ai/sdk/v2";
import { setRuntimeMode } from "../../../src/runtime/mode.js";

// Synthetic ids only - never real Telegram uids.
const PRIMARY_USER_ID = 111;
const SECONDARY_USER_ID = 222;

const ROOT_SESSION_ID = "session-1";
const CHILD_SESSION_ID = "child-session-1";
const GHOST_SESSION_ID = "ghost-session";

const mocked = vi.hoisted(() => ({
  subscribeToEvents: vi.fn(),
  stopEventListening: vi.fn(),
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
};

function createFakeBot(): { bot: Bot<Context>; api: FakeBotApi } {
  const api: FakeBotApi = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    // Rich rendering is tried first and falls back to plain text on this error.
    sendRichMessage: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Bad Request: rich message unavailable"), { error_code: 400 }),
      ),
    sendMessageDraft: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  };
  return { bot: { api } as unknown as Bot<Context>, api };
}

function emitTaskTool(summaryAggregator: { processEvent(event: Event): void }): void {
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part-task",
        sessionID: ROOT_SESSION_ID,
        messageID: "message-1",
        type: "tool",
        callID: "call-task",
        tool: "task",
        state: {
          status: "running",
          input: {
            description: "Explore the project",
            subagent_type: "explore",
            prompt: "Inspect architecture",
          },
          metadata: {},
        },
      },
    },
  } as unknown as Event);
}

function emitSubagentStart(summaryAggregator: { processEvent(event: Event): void }): void {
  summaryAggregator.processEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "subtask-1",
        sessionID: ROOT_SESSION_ID,
        messageID: "message-1",
        type: "subtask",
        prompt: "Inspect the project",
        description: "inspect task",
        agent: "explore",
      },
    },
  } as unknown as Event);

  summaryAggregator.processEvent({
    type: "session.created",
    properties: {
      info: {
        id: CHILD_SESSION_ID,
        parentID: ROOT_SESSION_ID,
        title: "inspect task (@explore subagent)",
        slug: "child",
        directory: "/tmp/opencode-test-workspace",
        projectID: "p1",
        version: "1",
        time: { created: Date.now(), updated: Date.now() },
      },
    },
  } as unknown as Event);
}

function emitPermissionAsked(
  summaryAggregator: { processEvent(event: Event): void },
  sessionId: string,
  requestID: string,
): void {
  summaryAggregator.processEvent({
    type: "permission.asked",
    properties: {
      id: requestID,
      sessionID: sessionId,
      permission: "external_directory",
      patterns: ["/tmp/shared/*"],
      metadata: {},
      always: ["/tmp/shared/*"],
    },
  } as unknown as Event);
}

function emitQuestionAsked(summaryAggregator: { processEvent(event: Event): void }): void {
  summaryAggregator.processEvent({
    type: "question.asked",
    properties: {
      id: "question-request-1",
      sessionID: summaryAggregatorCurrentSessionId(),
      questions: [
        {
          header: "Confirm",
          question: "Proceed with the plan?",
          multiple: false,
          options: [{ label: "Yes" }, { label: "No" }],
        },
      ],
    },
  } as unknown as Event);
}

// The question.asked handler drops events for any session other than the
// aggregator's current one, so the ghost/drop lane drives the event through a
// service whose aggregator session IS the unbound session.
let currentAggregatorSessionId = ROOT_SESSION_ID;

function summaryAggregatorCurrentSessionId(): string {
  return currentAggregatorSessionId;
}

async function flushPendingDispatch(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe("bot/services/event-subscription-service multi-operator routing", () => {
  let tempHome: string;
  let activeService: { cleanup(reason: string): void } | null = null;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "event-service-multi-op-"));
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
    setRuntimeMode("installed");

    mocked.subscribeToEvents.mockReset();
    mocked.stopEventListening.mockReset();
    mocked.subscribeToEvents.mockResolvedValue(undefined);

    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
  });

  afterEach(async () => {
    activeService?.cleanup("test_cleanup");
    activeService = null;

    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    vi.unstubAllEnvs();
  });

  /**
   * Fresh module registry per call so the frozen `config.telegram` allowlist
   * matches the env stubbed by the calling test.
   */
  async function setupService(options: {
    allowUserIds: string;
    boundSessions?: Array<{ userId: number; sessionId: string }>;
    aggregatorSessionId?: string;
  }): Promise<{ api: FakeBotApi; summaryAggregator: { processEvent(event: Event): void } }> {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", String(PRIMARY_USER_ID));
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", options.allowUserIds);
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.resetModules();

    const [
      { createEventSubscriptionService },
      { summaryAggregator },
      { userScope },
      settingsStore,
    ] = await Promise.all([
      import("../../../src/bot/services/event-subscription-service.js"),
      import("../../../src/app/managers/summary-aggregation-manager.js"),
      import("../../../src/app/stores/user-scope.js"),
      import("../../../src/app/stores/settings-store.js"),
    ]);

    settingsStore.__resetSettingsForTests();

    for (const { userId, sessionId } of options.boundSessions ?? []) {
      await userScope.run({ userId }, async () => {
        settingsStore.setCurrentSession({
          id: sessionId,
          title: `Tape ${sessionId}`,
          directory: "/tmp/opencode-test-workspace",
        });
      });
    }

    const { bot, api } = createFakeBot();
    const service = createEventSubscriptionService();
    activeService = service;
    // The primary operator's delivery chat, exactly what production wires in.
    service.setTelegramContext(bot, PRIMARY_USER_ID);
    await service.ensureEventSubscription("/tmp/opencode-test-workspace");

    currentAggregatorSessionId = options.aggregatorSessionId ?? ROOT_SESSION_ID;
    summaryAggregator.setSession(currentAggregatorSessionId);

    return { api, summaryAggregator };
  }

  function collectTargetChatIds(api: FakeBotApi): number[] {
    return [
      ...api.sendMessage.mock.calls.map((call) => call[0] as number),
      ...api.editMessageText.mock.calls.map((call) => call[0] as number),
    ];
  }

  it("routes a subagent's permission prompt to the parent session's operator", async () => {
    const { api, summaryAggregator } = await setupService({
      allowUserIds: `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`,
      boundSessions: [{ userId: SECONDARY_USER_ID, sessionId: ROOT_SESSION_ID }],
    });

    emitTaskTool(summaryAggregator);
    emitSubagentStart(summaryAggregator);
    emitPermissionAsked(summaryAggregator, CHILD_SESSION_ID, "req-child-1");
    await flushPendingDispatch();

    const targetChatIds = collectTargetChatIds(api);
    expect(targetChatIds).toContain(SECONDARY_USER_ID);
    expect(targetChatIds).not.toContain(PRIMARY_USER_ID);
  });

  it("renders a bound session's question poll in the owning operator's chat", async () => {
    const { api, summaryAggregator } = await setupService({
      allowUserIds: `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`,
      boundSessions: [{ userId: SECONDARY_USER_ID, sessionId: ROOT_SESSION_ID }],
    });

    emitQuestionAsked(summaryAggregator);
    await flushPendingDispatch();

    const targetChatIds = collectTargetChatIds(api);
    expect(targetChatIds).toContain(SECONDARY_USER_ID);
    expect(targetChatIds).not.toContain(PRIMARY_USER_ID);
  });

  it("drops question events for sessions no operator owns instead of falling back to the primary chat", async () => {
    const { api, summaryAggregator } = await setupService({
      allowUserIds: `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`,
      aggregatorSessionId: GHOST_SESSION_ID,
    });

    emitQuestionAsked(summaryAggregator);
    await flushPendingDispatch();

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.editMessageText).not.toHaveBeenCalled();
  });

  it("keeps solo question rendering on the primary chat", async () => {
    const { api, summaryAggregator } = await setupService({
      allowUserIds: "",
      // Post-seed solo reality: the operator's tape is bound to their own id,
      // which for a Telegram private chat equals their delivery chat.
      boundSessions: [{ userId: PRIMARY_USER_ID, sessionId: ROOT_SESSION_ID }],
    });

    emitQuestionAsked(summaryAggregator);
    await flushPendingDispatch();

    const targetChatIds = collectTargetChatIds(api);
    expect(targetChatIds).toContain(PRIMARY_USER_ID);
  });
});
