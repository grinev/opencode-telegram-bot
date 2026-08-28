import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";

const mocked = vi.hoisted(() => ({
  isOpencodeServerHealthyMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../src/opencode/ready-refresh.js", () => ({
  isOpencodeServerHealthy: mocked.isOpencodeServerHealthyMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import { startHealthServer, stopHealthServer } from "../../src/health/server.js";

function fetchJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: data });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer(port: number, timeout = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await fetchJson(port, "/health/live");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("Server did not start in time");
}

describe("health/server", () => {
  let port: number;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Use random port to avoid conflicts
    port = 3100 + Math.floor(Math.random() * 1000);
    mocked.isOpencodeServerHealthyMock.mockResolvedValue(true);
  });

  afterEach(async () => {
    await stopHealthServer();
    await new Promise((r) => setTimeout(r, 100));
  });

  it("starts and stops server with port > 0", async () => {
    await startHealthServer(port, "test-1.0.0");
    await waitForServer(port);

    const live = await fetchJson(port, "/health/live");
    expect(live.status).toBe(200);
    expect(live.body).toMatchObject({ status: "healthy", version: "test-1.0.0" });

    await stopHealthServer();
    const infoCalls = mocked.loggerInfoMock.mock.calls.map((c) => c[0]);
    expect(infoCalls.some((msg) => msg.includes("Health server listening"))).toBe(true);
    expect(infoCalls.some((msg) => msg.includes("Health server stopped"))).toBe(true);
  });

  it("does not start server when port is 0", async () => {
    await startHealthServer(0, "test-1.0.0");
    expect(mocked.loggerInfoMock).toHaveBeenCalledWith("[Health] Health server disabled (BOT_HEALTH_PORT=0)");
  });

  it("/health/live returns 200 with basic info", async () => {
    await startHealthServer(port, "test-1.0.0");
    await waitForServer(port);

    const res = await fetchJson(port, "/health/live");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "healthy", version: "test-1.0.0" });
  });

  it("/health/ready returns 200 when opencode healthy", async () => {
    mocked.isOpencodeServerHealthyMock.mockResolvedValue(true);
    await startHealthServer(port, "test-1.0.0");
    await waitForServer(port);

    const res = await fetchJson(port, "/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "healthy",
      version: "test-1.0.0",
      checks: { process: { healthy: true }, opencode: { healthy: true } },
    });
  });

  it("/health/ready returns 503 when opencode unhealthy", async () => {
    mocked.isOpencodeServerHealthyMock.mockResolvedValue(false);
    await startHealthServer(port, "test-1.0.0");
    await waitForServer(port);

    const res = await fetchJson(port, "/health/ready");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: "degraded",
      checks: { process: { healthy: true }, opencode: { healthy: false } },
    });
  });

  it("/health returns 200 with full payload", async () => {
    mocked.isOpencodeServerHealthyMock.mockResolvedValue(true);
    await startHealthServer(port, "test-1.0.0");
    await waitForServer(port);

    const res = await fetchJson(port, "/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "healthy",
      version: "test-1.0.0",
      checks: { process: { healthy: true }, opencode: { healthy: true } },
    });
  });

  it("/health returns 200 (not 503) even when degraded", async () => {
    mocked.isOpencodeServerHealthyMock.mockResolvedValue(false);
    await startHealthServer(port, "test-1.0.0");
    await waitForServer(port);

    const res = await fetchJson(port, "/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "degraded" });
  });

  it("port=0 disables server completely", async () => {
    await startHealthServer(0, "test");
    // Try to connect - should fail
    try {
      await fetchJson(port, "/health");
      throw new Error("Should have failed");
    } catch (e) {
      expect((e as Error).message).toMatch(/ECONNREFUSED|fetch failed/);
    }
  });

  it("lifecycle: multiple start/stop calls are safe", async () => {
    await startHealthServer(port, "v1");
    await waitForServer(port);
    await startHealthServer(port, "v2"); // Should warn, not start second
    await stopHealthServer();
    await stopHealthServer(); // Should not throw
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith("[Health] Health server already running");
  });

  it("unknown path returns 404", async () => {
    await startHealthServer(port, "test");
    await waitForServer(port);
    const res = await fetchJson(port, "/health/unknown");
    expect(res.status).toBe(404);
  });

  it("non-GET returns 405", async () => {
    await startHealthServer(port, "test");
    await waitForServer(port);
    // Use native fetch for method test
    const res = await fetch(`http://127.0.0.1:${port}/health`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});