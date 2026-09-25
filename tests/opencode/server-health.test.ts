import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  healthMock: vi.fn(),
  probeMock: vi.fn(),
  serverVersion: "v1" as "v1" | "v2",
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    global: {
      health: mocked.healthMock,
    },
  },
  get opencodeServerVersion() {
    return mocked.serverVersion;
  },
  probeOpencodeServer: mocked.probeMock,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: { apiUrl: "http://user:secret@127.0.0.1:4096" },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import {
  __resetServerHealthStateForTests,
  checkOpencodeHealth,
  classifyFailedHealthCheck,
  explainFailedHealthCheck,
} from "../../src/opencode/server-health.js";

describe("opencode/server-health", () => {
  beforeEach(() => {
    __resetServerHealthStateForTests();
    mocked.serverVersion = "v1";
    mocked.healthMock.mockReset();
    mocked.probeMock.mockReset();
    mocked.probeMock.mockResolvedValue({ kind: "none" });
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  it("reports a matching server as healthy with its version", async () => {
    mocked.healthMock.mockResolvedValue({ data: { healthy: true, version: "1.18.32" } });

    await expect(checkOpencodeHealth()).resolves.toEqual({ healthy: true, version: "1.18.32" });
    expect(mocked.probeMock).not.toHaveBeenCalled();
  });

  it("logs a version mismatch naming both versions and never the credentials", async () => {
    mocked.healthMock.mockResolvedValue({ data: "<!doctype html>" });
    mocked.probeMock.mockImplementation(async (version: string) =>
      version === "v2"
        ? { kind: "found", version: "v2", serverVersion: "2.0.16" }
        : { kind: "none" },
    );

    const health = await checkOpencodeHealth();

    expect(health.healthy).toBe(false);
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(1);
    const message = mocked.loggerErrorMock.mock.calls[0]?.[0] as string;
    expect(message).toContain("OPENCODE_SERVER_VERSION=v1");
    expect(message).toContain("OpenCode 2.0.16 (API v2)");
    expect(message).toContain("Set OPENCODE_SERVER_VERSION=v2");
    expect(message).toContain("http://127.0.0.1:4096");
    expect(message).not.toContain("secret");
  });

  it("logs the same mismatch only once until the server is healthy again", async () => {
    mocked.healthMock.mockResolvedValue({ data: undefined, error: new Error("Unexpected status") });
    mocked.probeMock.mockImplementation(async (version: string) =>
      version === "v2"
        ? { kind: "found", version: "v2", serverVersion: "2.0.16" }
        : { kind: "none" },
    );

    await checkOpencodeHealth();
    await checkOpencodeHealth();
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(1);

    mocked.healthMock.mockResolvedValueOnce({ data: { healthy: true, version: "1.18.32" } });
    await checkOpencodeHealth();
    await checkOpencodeHealth();
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(2);
  });

  it("reports wrong credentials as an authentication problem, not a mismatch", async () => {
    mocked.serverVersion = "v2";
    mocked.healthMock.mockResolvedValue({
      data: undefined,
      error: new Error("UnsupportedContentType"),
    });
    mocked.probeMock.mockImplementation(async (version: string) =>
      version === "v2" ? { kind: "unauthorized" } : { kind: "none" },
    );

    const health = await checkOpencodeHealth();

    expect(health.healthy).toBe(false);
    expect(mocked.loggerErrorMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Authentication failed"),
    );
  });

  it("recognises a password-protected server of the other version as a mismatch", async () => {
    mocked.healthMock.mockResolvedValue({ data: "<!doctype html>" });
    mocked.probeMock.mockImplementation(async (version: string) =>
      version === "v2" ? { kind: "unauthorized" } : { kind: "none" },
    );

    await checkOpencodeHealth();

    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(1);
    const message = mocked.loggerErrorMock.mock.calls[0]?.[0] as string;
    expect(message).toContain("OPENCODE_SERVER_VERSION=v1");
    expect(message).toContain("(API v2)");
    expect(message).toContain("Set OPENCODE_SERVER_VERSION=v2");
  });

  it("does not probe when the server is not running", async () => {
    mocked.healthMock.mockResolvedValue({
      data: undefined,
      error: new Error("Transport: fetch failed"),
    });

    const health = await checkOpencodeHealth();

    expect(health.healthy).toBe(false);
    expect(mocked.probeMock).not.toHaveBeenCalled();
  });

  it("logs nothing when neither version answers", async () => {
    mocked.healthMock.mockRejectedValue(new Error("boom"));

    const health = await checkOpencodeHealth();

    expect(health.healthy).toBe(false);
    expect(mocked.probeMock).toHaveBeenCalledWith("v1");
    expect(mocked.probeMock).toHaveBeenCalledWith("v2");
    expect(mocked.loggerErrorMock).not.toHaveBeenCalled();
  });

  it("classifies a failed health check without logging", async () => {
    mocked.probeMock.mockImplementation(async (version: string) =>
      version === "v2"
        ? { kind: "found", version: "v2", serverVersion: "2.0.16" }
        : { kind: "none" },
    );

    await expect(classifyFailedHealthCheck()).resolves.toEqual({
      kind: "mismatch",
      actual: "OpenCode 2.0.16",
      otherVersion: "v2",
    });
    expect(mocked.loggerErrorMock).not.toHaveBeenCalled();

    mocked.probeMock.mockResolvedValue({ kind: "unauthorized" });
    await expect(classifyFailedHealthCheck()).resolves.toEqual({ kind: "unauthorized" });
  });

  it("explains a failure every time in always mode and once in once mode", async () => {
    mocked.probeMock.mockResolvedValue({ kind: "unauthorized" });

    await explainFailedHealthCheck("once");
    await explainFailedHealthCheck("once");
    expect(mocked.loggerWarnMock).toHaveBeenCalledTimes(1);

    await explainFailedHealthCheck("always");
    await explainFailedHealthCheck("always");
    expect(mocked.loggerWarnMock).toHaveBeenCalledTimes(3);
  });
});
