import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  v2Options: null as { baseUrl: string; headers?: Record<string, string> } | null,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: {
      serverVersion: "v2",
      apiUrl: "http://127.0.0.1:49374",
      username: "opencode",
      password: "configured-secret",
    },
  },
}));

vi.mock("../../src/opencode/v2/client.js", () => ({
  createV2OpencodeClient: (options: { baseUrl: string; headers?: Record<string, string> }) => {
    mocked.v2Options = options;
    return {};
  },
  findRegisteredV2Server: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { probeOpencodeServer } from "../../src/opencode/client.js";
import {
  __resetOpencodeServerTargetForTests,
  switchOpencodeServer,
} from "../../src/opencode/server-target.js";

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

describe("opencode/client", () => {
  beforeEach(() => {
    __resetOpencodeServerTargetForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("points the V2 client at the active server on every request", () => {
    const options = mocked.v2Options;
    expect(options?.baseUrl).toBe("http://127.0.0.1:49374");
    expect(options?.headers).toEqual({ Authorization: basic("opencode", "configured-secret") });

    switchOpencodeServer({
      url: "http://127.0.0.1:28894",
      username: "opencode",
      password: "registry-secret",
    });

    expect(options?.baseUrl).toBe("http://127.0.0.1:28894");
    expect(options?.headers).toEqual({ Authorization: basic("opencode", "registry-secret") });
  });

  it("sends no Authorization header to a server without credentials", () => {
    switchOpencodeServer({ url: "http://127.0.0.1:28894" });

    expect(mocked.v2Options?.headers).toEqual({});
  });

  it("probes a given server with that server's credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "2.1.3", pid: 7 }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const probe = await probeOpencodeServer("v2", {
      url: "http://127.0.0.1:28894",
      username: "opencode",
      password: "registry-secret",
    });

    expect(probe).toEqual({ kind: "found", version: "v2", serverVersion: "2.1.3" });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:28894/api/info");
    expect(init.headers).toEqual({ Authorization: basic("opencode", "registry-secret") });
  });
});
