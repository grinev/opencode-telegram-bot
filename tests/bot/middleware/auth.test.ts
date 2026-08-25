import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

// Synthetic ids only - never real Telegram uids.
const PRIMARY_USER_ID = 111;
const SECONDARY_USER_ID = 222;
const INTRUDER_USER_ID = 999;

function createContext(userId: number, chatId: number): Context {
  return {
    from: { id: userId },
    chat: { id: chatId },
    api: {
      setMyCommands: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

describe("bot/middleware/auth multi-operator scoping", () => {
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", String(PRIMARY_USER_ID));
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
  });

  /**
   * Fresh module registry so the frozen `config.telegram` allowlist matches
   * the env stubbed by the calling test (global setup seeds a default first).
   */
  async function loadModules() {
    vi.resetModules();
    const [{ authMiddleware }, { userScope }] = await Promise.all([
      import("../../../src/bot/middleware/auth.js"),
      import("../../../src/app/stores/user-scope.js"),
    ]);
    return { authMiddleware, userScope };
  }

  it("enters the operator's user scope around authorized updates", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`);
    const { authMiddleware, userScope } = await loadModules();

    let nextCalled = false;
    let scopeInsideHandler: number | undefined;
    const next = async () => {
      nextCalled = true;
      scopeInsideHandler = userScope.getStore()?.userId;
    };

    await authMiddleware(createContext(SECONDARY_USER_ID, SECONDARY_USER_ID), next);

    expect(nextCalled).toBe(true);
    expect(scopeInsideHandler).toBe(SECONDARY_USER_ID);
  });

  it("keeps each operator's scope separate per update", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`);
    const { authMiddleware, userScope } = await loadModules();

    const observed: (number | undefined)[] = [];
    const next = async () => {
      observed.push(userScope.getStore()?.userId);
    };

    await authMiddleware(createContext(SECONDARY_USER_ID, SECONDARY_USER_ID), next);
    await authMiddleware(createContext(PRIMARY_USER_ID, PRIMARY_USER_ID), next);

    expect(observed).toEqual([SECONDARY_USER_ID, PRIMARY_USER_ID]);
  });

  it("drops unauthorized updates without entering any scope", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", `${PRIMARY_USER_ID},${SECONDARY_USER_ID}`);
    const { authMiddleware, userScope } = await loadModules();

    let nextCalled = false;
    const next = async () => {
      nextCalled = true;
    };

    const ctx = createContext(INTRUDER_USER_ID, INTRUDER_USER_ID);
    await authMiddleware(ctx, next);

    expect(nextCalled).toBe(false);
    expect(userScope.getStore()).toBeUndefined();
    // Unauthorized chats get their command list hidden.
    expect(ctx.api.setMyCommands).toHaveBeenCalledWith([], {
      scope: { type: "chat", chat_id: INTRUDER_USER_ID },
    });
  });
});
