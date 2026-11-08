import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: {
      serverVersion: "v2",
    },
    gateway: {
      requestTimeoutMs: 1_000,
    },
  },
}));

import { GatewayClient, GatewayClientError } from "../../src/gateway/client.js";

const statusResponse = {
  status: "healthy",
  target: { ip: "10.0.0.10", port: 4096, reachable: true },
  opencode: {
    reachable: true,
    healthy: true,
    authenticationRequired: false,
  },
  readiness: {
    checkedAt: "2026-11-08T00:00:00.000Z",
    latencyMs: 12,
    wakeInProgress: false,
  },
};

describe("GatewayClient", () => {
  it("sends the shared secret and parses status responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(statusResponse), { status: 200 }),
    );
    const client = new GatewayClient("http://gateway:8787", "shared-secret", {
      fetch: fetchMock,
    });

    await expect(client.getStatus()).resolves.toEqual(statusResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://gateway:8787/status",
      expect.objectContaining({
        method: "GET",
        headers: { "X-Gateway-Secret": "shared-secret" },
      }),
    );
  });

  it("turns gateway errors into safe client errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid gateway secret" }), { status: 401 }),
    );
    const client = new GatewayClient("http://gateway:8787", "shared-secret", {
      fetch: fetchMock,
    });

    await expect(client.getStatus()).rejects.toEqual(
      new GatewayClientError("invalid gateway secret", 401),
    );
  });

  it("does not make requests without a shared secret", async () => {
    const fetchMock = vi.fn();
    const client = new GatewayClient("http://gateway:8787", "", { fetch: fetchMock });

    await expect(client.wake()).rejects.toThrow("Gateway access is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
