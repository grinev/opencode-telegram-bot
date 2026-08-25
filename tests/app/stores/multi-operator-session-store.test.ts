import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../../src/app/types/session.js";

function sessionInfo(id: string): SessionInfo {
  return { id, title: `Session ${id}`, directory: "/tmp/opencode-test-workspace" };
}

// Each test reloads config + stores through a fresh module registry so the
// frozen `config.telegram` object matches the env stubbed for that test.
describe("multi-operator scoped session storage", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-multi-op-"));
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
  });

  afterEach(async () => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    await rm(tempHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function loadStore() {
    // Pin both allowlist variables explicitly: config is rebuilt inside this
    // test and must not depend on ambient env left by other test files.
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
    vi.resetModules();

    const configModule = await import("../../../src/config.js");
    const scopeModule = await import("../../../src/app/stores/user-scope.js");
    const storeModule = await import("../../../src/app/stores/settings-store.js");

    return {
      config: configModule.config,
      userScope: scopeModule.userScope,
      ...storeModule,
    };
  }

  it("seeds a solo operator's map entry from the legacy tape on first contact", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "1234");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "");
    const store = await loadStore();

    store.setCurrentSession(sessionInfo("legacy-1"));

    await store.userScope.run({ userId: 1234 }, async () => {
      expect(store.getCurrentSession()?.id).toBe("legacy-1");
    });

    expect(store.getAllUserSessions()["1234"]?.id).toBe("legacy-1");
    expect(store.getRawCurrentSession()?.id).toBe("legacy-1");
  });

  it("never inherits the legacy tape when multiple operators are configured", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "1234,5678");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "1234");
    const store = await loadStore();

    store.setCurrentSession(sessionInfo("legacy-1"));

    await store.userScope.run({ userId: 5678 }, async () => {
      expect(store.getCurrentSession()).toBeUndefined();
    });

    expect(store.getAllUserSessions()).toEqual({});
  });

  it("keeps each operator's session tape isolated", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "1234,5678");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "1234");
    const store = await loadStore();

    await store.userScope.run({ userId: 1234 }, async () => {
      store.setCurrentSession(sessionInfo("session-a"));
    });
    await store.userScope.run({ userId: 5678 }, async () => {
      store.setCurrentSession(sessionInfo("session-b"));
    });

    await store.userScope.run({ userId: 1234 }, async () => {
      expect(store.getCurrentSession()?.id).toBe("session-a");
    });
    await store.userScope.run({ userId: 5678 }, async () => {
      expect(store.getCurrentSession()?.id).toBe("session-b");
    });
    expect(store.getRawCurrentSession()).toBeUndefined();
  });

  it("clears only the scoped operator's session entry", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "1234,5678");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "1234");
    const store = await loadStore();

    await store.userScope.run({ userId: 1234 }, async () => {
      store.setCurrentSession(sessionInfo("session-a"));
    });
    await store.userScope.run({ userId: 5678 }, async () => {
      store.setCurrentSession(sessionInfo("session-b"));
    });
    await store.userScope.run({ userId: 1234 }, async () => {
      store.clearSession();
      expect(store.getCurrentSession()).toBeUndefined();
    });

    expect(store.getSessionChatBinding("session-b")).toBe(5678);
    expect(store.getSessionChatBinding("session-a")).toBeNull();
  });

  it("resolves the owning chat id for a bound session and null otherwise", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "1234,5678");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "1234");
    const store = await loadStore();

    await store.userScope.run({ userId: 1234 }, async () => {
      store.setCurrentSession(sessionInfo("session-a"));
    });
    store.setCurrentSession(sessionInfo("legacy-1"));

    expect(store.getSessionChatBinding("session-a")).toBe(1234);
    expect(store.getSessionChatBinding("legacy-1")).toBeNull();
    expect(store.getSessionChatBinding("session-missing")).toBeNull();
  });

  it("keeps unscoped writes on the legacy pointer outside any scope", async () => {
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "1234,5678");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_ID", "1234");
    const store = await loadStore();

    store.setCurrentSession(sessionInfo("legacy-1"));

    expect(store.getRawCurrentSession()?.id).toBe("legacy-1");
    expect(store.getAllUserSessions()).toEqual({});
    expect(store.getCurrentSession()?.id).toBe("legacy-1");
  });
});
