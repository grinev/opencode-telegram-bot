import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  checkOpencodeHealthMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/opencode/server-health.js", () => ({
  checkOpencodeHealth: mocked.checkOpencodeHealthMock,
  __resetServerHealthStateForTests: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import { HealthServer } from "../../../src/app/services/health-server-service.js";

async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function request(
  port: number,
  path: string,
  method = "GET",
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

describe("app/services/health-server-service", () => {
  let healthServer: HealthServer;
  let port: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocked.checkOpencodeHealthMock.mockResolvedValue({ healthy: true, version: "1.0.0" });
    healthServer = new HealthServer();
    port = await freePort();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await healthServer.stop();
  });

  it("does not listen when the port is 0", async () => {
    await healthServer.start(0, "test-1.0.0");

    expect(mocked.loggerInfoMock).toHaveBeenCalledWith(expect.stringContaining("disabled"));
    await expect(fetch(`http://127.0.0.1:${port}/health/live`)).rejects.toThrow();
  });

  it("answers /health/live with 200 and basic info without checking OpenCode", async () => {
    await healthServer.start(port, "test-1.0.0");

    const res = await request(port, "/health/live");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.body).toMatchObject({ status: "healthy", version: "test-1.0.0", uptimeSeconds: 0 });
    expect(typeof (res.body as { timestamp: unknown }).timestamp).toBe("string");
    expect(mocked.checkOpencodeHealthMock).not.toHaveBeenCalled();
  });

  it("answers /health/ready with 200 when OpenCode is healthy", async () => {
    await healthServer.start(port, "test-1.0.0");

    const res = await request(port, "/health/ready");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "healthy",
      version: "test-1.0.0",
      checks: { process: { healthy: true }, opencode: { healthy: true } },
    });
  });

  it("answers /health/ready with 503 when OpenCode is unhealthy", async () => {
    mocked.checkOpencodeHealthMock.mockResolvedValue({ healthy: false, error: new Error("down") });
    await healthServer.start(port, "test-1.0.0");

    const res = await request(port, "/health/ready");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: "degraded",
      checks: { process: { healthy: true }, opencode: { healthy: false } },
    });
  });

  it("answers /health with 200 and the status field whether healthy or degraded", async () => {
    await healthServer.start(port, "test-1.0.0");

    const healthy = await request(port, "/health");
    mocked.checkOpencodeHealthMock.mockResolvedValue({ healthy: false, error: new Error("down") });
    const degraded = await request(port, "/health");

    expect(healthy.status).toBe(200);
    expect(healthy.body).toMatchObject({ status: "healthy" });
    expect(degraded.status).toBe(200);
    expect(degraded.body).toMatchObject({ status: "degraded" });
  });

  it("counts an OpenCode check slower than 3 seconds as not answering", async () => {
    mocked.checkOpencodeHealthMock.mockReturnValue(new Promise(() => undefined));
    await healthServer.start(port, "test-1.0.0");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const pending = request(port, "/health");
    await vi.waitFor(() => {
      expect(mocked.checkOpencodeHealthMock).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(3000);
    const res = await pending;

    expect(res.body).toMatchObject({
      status: "degraded",
      checks: { opencode: { healthy: false, error: "timeout" } },
    });
  });

  it("answers an unknown path with 404 and a non-GET method with 405", async () => {
    await healthServer.start(port, "test-1.0.0");

    const notFound = await request(port, "/health/unknown");
    const notAllowed = await request(port, "/health", "POST");

    expect(notFound.status).toBe(404);
    expect(notFound.body).toEqual({ error: "Not found", path: "/health/unknown" });
    expect(notAllowed.status).toBe(405);
    expect(notAllowed.body).toEqual({ error: "Method not allowed" });
  });

  it("answers 404 to a request target that is not a valid URL path", async () => {
    await healthServer.start(port, "test-1.0.0");

    const status = await new Promise<number | undefined>((resolve, reject) => {
      http
        .request({ host: "127.0.0.1", port, path: "//", method: "GET" }, (res) => {
          res.resume();
          resolve(res.statusCode);
        })
        .on("error", reject)
        .end();
    });

    expect(status).toBe(404);
  });

  it("ignores the query string when matching a route", async () => {
    await healthServer.start(port, "test-1.0.0");

    const res = await request(port, "/health/live?probe=1");

    expect(res.status).toBe(200);
  });

  it("warns on a second start and tolerates repeated stops", async () => {
    await healthServer.start(port, "v1");
    await healthServer.start(port, "v2");

    expect(mocked.loggerWarnMock).toHaveBeenCalledWith("[Health] Health server already running");

    await healthServer.stop();
    await healthServer.stop();

    const stoppedLogs = mocked.loggerInfoMock.mock.calls.filter(([message]) =>
      String(message).includes("Health server stopped"),
    );
    expect(stoppedLogs).toHaveLength(1);
  });

  it("keeps running without the endpoint when the port is busy, and a later start retries", async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
    try {
      await expect(healthServer.start(port, "test-1.0.0")).resolves.toBeUndefined();
      expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
        expect.stringContaining(`could not listen on 127.0.0.1:${port}`),
        expect.anything(),
      );
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }

    await healthServer.start(port, "test-1.0.0");
    const res = await request(port, "/health/live");

    expect(res.status).toBe(200);
  });
});
