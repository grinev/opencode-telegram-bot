import { rm } from "node:fs/promises";
import { createTestHome } from "../../helpers/test-environment.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import { setRuntimeMode } from "../../../src/runtime/mode.js";
import { resetSingletonState } from "../../helpers/reset-singleton-state.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import type { ReconnectInfo } from "../../../src/opencode/events.js";
import type { BotEventSubscriptionService } from "../../../src/bot/services/event-subscription-service.js";

const mocked = vi.hoisted(() => ({
  subscribeToEvents: vi.fn(),
  stopEventListening: vi.fn(),
  restorePendingInteractionsAfterReconnect: vi.fn(),
  inboxList: vi.fn(),
}));

vi.mock("../../../src/opencode/events.js", () => ({
  subscribeToEvents: mocked.subscribeToEvents,
  stopEventListening: mocked.stopEventListening,
}));

vi.mock("../../../src/opencode/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/opencode/client.js")>()),
  opencodeServerVersion: "v2",
  opencodeV2Client: { session: { inbox: { list: mocked.inboxList, cancel: vi.fn() } } },
}));

vi.mock("../../../src/app/services/attach-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/services/attach-service.js")>()),
  restorePendingInteractionsAfterReconnect: mocked.restorePendingInteractionsAfterReconnect,
}));

function mirror(inboxId: string): void {
  promptQueue.confirmReservation(promptQueue.reserve()!, {
    displayText: inboxId,
    inbox: { sessionId: "session-1", inboxId, delivery: "steer" },
  });
}

function mirroredInboxIds(): string[] {
  return promptQueue.list().map((item) => item.inbox?.inboxId ?? "");
}

function reconnect(info: ReconnectInfo): void {
  const onReconnect = mocked.subscribeToEvents.mock.calls.at(-1)?.[2] as (
    info: ReconnectInfo,
  ) => void;
  onReconnect(info);
}

describe("bot/services/event-subscription-service inbox after reconnect", () => {
  let tempHome = "";
  let service: BotEventSubscriptionService | null = null;

  beforeEach(async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", await createTestHome("inbox-reconnect-"));
    tempHome = process.env.OPENCODE_TELEGRAM_HOME!;
    setRuntimeMode("installed");

    mocked.subscribeToEvents.mockReset().mockResolvedValue(undefined);
    mocked.restorePendingInteractionsAfterReconnect.mockReset().mockResolvedValue(undefined);
    mocked.inboxList.mockReset().mockResolvedValue({ data: [], error: undefined });

    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
    await resetSingletonState();

    const [{ createEventSubscriptionService }, sessionService] = await Promise.all([
      import("../../../src/bot/services/event-subscription-service.js"),
      import("../../../src/app/services/session-service.js"),
    ]);
    sessionService.setCurrentSession({ id: "session-1", title: "Test", directory: "D:/repo" });

    const api = { sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }) };
    service = createEventSubscriptionService(createTestAppContainer());
    service.clearRuntimeState("test_setup");
    service.setTelegramContext({ api } as unknown as Bot<Context>, 42);
    await service.ensureEventSubscription("D:/repo");
  });

  afterEach(async () => {
    service?.cleanup("test_cleanup");
    service = null;
    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    await settingsStore.flushSettings();
    settingsStore.__resetSettingsForTests();
    vi.unstubAllEnvs();
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it.each([
    ["the same server", false],
    ["a restarted server", true],
    ["a server it cannot tell", null],
  ])(
    "drops the buttons of messages OpenCode no longer holds after a reconnect to %s",
    async (_label, serverRestarted) => {
      mirror("msg-picked");
      mirror("msg-waiting");
      mocked.inboxList.mockResolvedValue({ data: ["msg-waiting"], error: undefined });

      reconnect({ serverRestarted });

      await vi.waitFor(() => expect(mirroredInboxIds()).toEqual(["msg-waiting"]));
      expect(mocked.inboxList).toHaveBeenCalledWith({ sessionID: "session-1" });
    },
  );

  it("keeps every button when the inbox cannot be read", async () => {
    mirror("msg-1");
    mirror("msg-2");
    mocked.inboxList.mockResolvedValue({ data: undefined, error: new Error("down") });

    reconnect({ serverRestarted: false });

    await vi.waitFor(() => expect(mocked.inboxList).toHaveBeenCalled());
    await new Promise((resolve) => setImmediate(resolve));
    expect(mirroredInboxIds()).toEqual(["msg-1", "msg-2"]);
  });

  it("leaves a message still on its way to OpenCode to its admission", async () => {
    mirror("msg-picked");
    const reservationId = promptQueue.reserve()!;

    reconnect({ serverRestarted: false });

    await vi.waitFor(() => expect(mirroredInboxIds()).toEqual([]));
    const confirmed = promptQueue.confirmReservation(reservationId, {
      displayText: "late",
      inbox: { sessionId: "session-1", inboxId: "msg-late", delivery: "steer" },
    });
    expect(confirmed).not.toBeNull();
  });

  it("asks OpenCode nothing without a current session", async () => {
    const sessionService = await import("../../../src/app/services/session-service.js");
    sessionService.clearSession();

    reconnect({ serverRestarted: false });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocked.inboxList).not.toHaveBeenCalled();
  });
});
