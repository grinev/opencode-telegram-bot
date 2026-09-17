import { beforeEach, describe, expect, it, vi } from "vitest";

const { settings, legacy, v2, createLegacy, createV2 } = vi.hoisted(() => {
  const legacy = { version: "legacy" };
  const v2 = { version: "v2" };
  return {
    settings: {
      apiV2Enabled: false,
      apiUrl: "http://localhost:4096",
      username: "opencode",
      password: "",
    },
    legacy,
    v2,
    createLegacy: vi.fn(() => legacy),
    createV2: vi.fn(() => v2),
  };
});
vi.mock("../../src/config.js", () => ({ config: { opencode: settings } }));
vi.mock("@opencode-ai/sdk/v2", () => ({ createOpencodeClient: createLegacy }));
vi.mock("../../src/opencode/v2-client.js", () => ({ createV2Client: createV2 }));

describe("OpenCode client selection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    settings.apiV2Enabled = false;
    settings.password = "";
  });

  it("selects the legacy SDK by default", async () => {
    const { opencodeClient } = await import("../../src/opencode/client.js");
    expect(opencodeClient).toBe(legacy);
    expect(createLegacy).toHaveBeenCalledWith({ baseUrl: settings.apiUrl, headers: undefined });
    expect(createV2).not.toHaveBeenCalled();
  });

  it("selects only the V2 adapter when enabled and forwards the configured authentication", async () => {
    settings.apiV2Enabled = true;
    settings["password"] = "test-" + "password";
    const { opencodeClient } = await import("../../src/opencode/client.js");
    expect(opencodeClient).toBe(v2);
    expect(createV2).toHaveBeenCalledWith({
      baseUrl: settings.apiUrl,
      headers: {
        Authorization: `Basic ${Buffer.from("opencode:test-password").toString("base64")}`,
      },
    });
    expect(createLegacy).not.toHaveBeenCalled();
  });
});
