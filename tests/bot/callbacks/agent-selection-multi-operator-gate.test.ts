import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

// Synthetic ids only - never real Telegram uids.
const PRIMARY_USER_ID = 111;
const SECONDARY_USER_ID = 222;
const MENU_MESSAGE_ID = 900;

function createCallbackContext(data: string): Context {
  return {
    chat: { id: PRIMARY_USER_ID },
    callbackQuery: {
      data,
      message: {
        message_id: MENU_MESSAGE_ID,
      },
    } as Context["callbackQuery"],
    api: {},
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: MENU_MESSAGE_ID + 1 }),
  } as unknown as Context;
}

describe("agent-selection callback multi-operator keyboard gate", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-agent-gate-"));
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.stubEnv("LOG_LEVEL", "error");
  });

  afterEach(async () => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    // Settings writes scheduled during the test need a real tick to land
    // before the temp home is removed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await rm(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    vi.unstubAllEnvs();
    const { resetSingletonState } = await import("../../helpers/reset-singleton-state.js");
    await resetSingletonState();
  });

  async function loadGate() {
    // Fresh module registry so the frozen `config.telegram` allowlist matches
    // the env stubbed for this lane (global setup seeds a default first).
    vi.resetModules();
    const [{ handleAgentSelect }, { keyboardManager }, { interactionManager }] = await Promise.all([
      import("../../../src/bot/callbacks/agent-selection-callback-handler.js"),
      import("../../../src/bot/keyboards/keyboard-manager.js"),
      import("../../../src/app/managers/interaction-manager.js"),
    ]);
    // Reset the singletons of THIS registry so no state leaks between lanes.
    const { resetSingletonState } = await import("../../helpers/reset-singleton-state.js");
    await resetSingletonState();
    return { handleAgentSelect, keyboardManager, interactionManager };
  }

  async function runAgentSelectionCallback() {
    const { handleAgentSelect, keyboardManager, interactionManager } = await loadGate();

    // Arm a live agent menu so the callback passes the active-menu check and
    // reaches the arm site under test instead of bailing as stale.
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "agent",
        messageId: MENU_MESSAGE_ID,
      },
    });

    const ctx = createCallbackContext(`agent:build`);
    const handled = await handleAgentSelect(ctx);

    return { handled, ctx, keyboardManager };
  }

  it("does not arm the reply keyboard from an agent callback in multi-operator mode", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", String(PRIMARY_USER_ID));
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`);

    const { handled, ctx, keyboardManager } = await runAgentSelectionCallback();

    expect(handled).toBe(true);
    // The handler ran to completion (confirmation sent with the new
    // keyboard), yet the single-slot manager stayed unarmed - the selection
    // must not adopt one operator's markup into the global slot.
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(keyboardManager.isInitialized()).toBe(false);
  });

  it("still arms the reply keyboard for the same callback in solo mode", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", String(PRIMARY_USER_ID));
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "");

    const { handled, ctx, keyboardManager } = await runAgentSelectionCallback();

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    // Sensitivity control for the lane above: identical rig with one
    // operator, so the suppression (not some early bail) is what held.
    expect(keyboardManager.isInitialized()).toBe(true);
  });
});
