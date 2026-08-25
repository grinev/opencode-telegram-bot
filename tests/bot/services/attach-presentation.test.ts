import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic ids only - never real Telegram uids.
const PRIMARY_USER_ID = 111;
const SECONDARY_USER_ID = 222;

type RecordedCall = { method: string; args: unknown[] };

/**
 * Records every API method invocation so the suppression lanes can assert that
 * the single-slot presentation surfaces stay completely untouched.
 */
function createRecordingApi(): { api: unknown; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const api = new Proxy(
    {},
    {
      get(_target, method: string) {
        return (...args: unknown[]) => {
          calls.push({ method, args });
          return Promise.resolve({ message_id: 1 });
        };
      },
    },
  );
  return { api, calls };
}

function sessionInfo(id: string) {
  return { id, title: `Session ${id}`, directory: "/tmp/opencode-test-workspace" };
}

describe("attach-presentation multi-operator suppression", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-attach-pres-"));
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    await resetPresentationState();
  });

  afterEach(async () => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    // Settings writes scheduled during the test need a real tick to land
    // before the temp home is removed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    vi.unstubAllEnvs();
    await resetPresentationState();
  });

  async function resetPresentationState() {
    const { resetSingletonState } = await import("../../helpers/reset-singleton-state.js");
    const settingsStore = await import("../../../src/app/stores/settings-store.js");
    settingsStore.__resetSettingsForTests();
    await resetSingletonState();
  }

  async function loadPresentation() {
    // Fresh module registry so the frozen `config.telegram` allowlist matches
    // the env stubbed for this test (global setup seeds a default first).
    vi.resetModules();
    const [{ createAttachPresentation }, { pinnedMessageManager }, { keyboardManager }] =
      await Promise.all([
        import("../../../src/bot/services/attach-presentation.js"),
        import("../../../src/bot/pinned/pinned-message-manager.js"),
        import("../../../src/bot/keyboards/keyboard-manager.js"),
      ]);
    // Reset the singletons of THIS registry so no state leaks between lanes.
    const { resetSingletonState } = await import("../../helpers/reset-singleton-state.js");
    await resetSingletonState();
    return { createAttachPresentation, pinnedMessageManager, keyboardManager };
  }

  it("never arms the pin pump or keyboard from any operator's flow in multi-op", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", String(PRIMARY_USER_ID));
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`);
    const { createAttachPresentation, pinnedMessageManager, keyboardManager } =
      await loadPresentation();
    // Simulate an operator having armed the single-slot card via /start or
    // /status before this call - the suppression must hold regardless.
    const commandApi = createRecordingApi();
    pinnedMessageManager.initialize(commandApi.api as never, SECONDARY_USER_ID);
    keyboardManager.initialize(commandApi.api as never, SECONDARY_USER_ID);

    const presentation = createAttachPresentation();
    const streamerApi = createRecordingApi();
    await presentation.ensurePinnedSession({
      api: streamerApi.api as never,
      chatId: SECONDARY_USER_ID,
      session: sessionInfo("session-a"),
    });

    // Without the unconditional guard the card adopts the session into the
    // arming operator's single slot; suppressed, nothing happens at all.
    expect(streamerApi.calls).toEqual([]);
    expect(pinnedMessageManager.getState().sessionId).toBeNull();
  });

  it("keeps syncAttachState a no-op even when the card was already initialized", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", String(PRIMARY_USER_ID));
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`);
    const { createAttachPresentation, pinnedMessageManager } = await loadPresentation();

    const anyApi = createRecordingApi();
    pinnedMessageManager.initialize(anyApi.api as never, PRIMARY_USER_ID);

    const presentation = createAttachPresentation();
    await presentation.syncAttachState(true, true);

    expect(pinnedMessageManager.getState().attachActive).toBe(false);
    expect(pinnedMessageManager.getState().attachBusy).toBe(false);
  });

  it("still drives the pin pump for a solo operator", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", String(PRIMARY_USER_ID));
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "");
    const { createAttachPresentation, pinnedMessageManager } = await loadPresentation();

    const presentation = createAttachPresentation();
    const soloApi = createRecordingApi();
    await presentation.ensurePinnedSession({
      api: soloApi.api as never,
      chatId: PRIMARY_USER_ID,
      session: sessionInfo("session-solo"),
    });

    // Sensitivity check for the lanes above: solo mode must reach the manager
    // and adopt the session into the single-slot card.
    expect(pinnedMessageManager.isInitialized()).toBe(true);
    expect(pinnedMessageManager.getState().sessionId).toBe("session-solo");
  });
});
