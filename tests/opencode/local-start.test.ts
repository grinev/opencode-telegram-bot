import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  probeMock: vi.fn(),
  findRegisteredMock: vi.fn(),
  readLocalVersionMock: vi.fn(),
  serverVersion: "v2" as "v1" | "v2",
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: { global: { health: vi.fn() } },
  get opencodeServerVersion() {
    return mocked.serverVersion;
  },
  probeOpencodeServer: mocked.probeMock,
  findRegisteredOpencodeServer: mocked.findRegisteredMock,
}));

vi.mock("../../src/opencode/process.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/opencode/process.js")>()),
  readLocalOpencodeVersion: mocked.readLocalVersionMock,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: { apiUrl: "http://127.0.0.1:4097" },
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

import { resolveUnavailableOpencodeServer } from "../../src/opencode/local-start.js";
import { __resetServerHealthStateForTests } from "../../src/opencode/server-health.js";
import {
  __resetOpencodeServerTargetForTests,
  getActiveOpencodeServer,
  isOnConfiguredOpencodeServer,
  switchOpencodeServer,
  type OpencodeServerTarget,
} from "../../src/opencode/server-target.js";

const TARGET = { host: "127.0.0.1", port: 4097 };
const CONFIGURED_URL = "http://127.0.0.1:4097";
const REGISTERED = { url: "http://127.0.0.1:49374", username: "opencode", password: "secret" };

type Probe =
  | { kind: "found"; version: "v1" | "v2"; serverVersion: string }
  | { kind: "unauthorized" }
  | { kind: "none" };

/** Answers probes per address; a probe without a server goes to the active one. */
function answerProbes(answer: (version: string, url: string) => Probe): void {
  mocked.probeMock.mockImplementation(async (version: string, server?: OpencodeServerTarget) =>
    answer(version, (server ?? getActiveOpencodeServer()).url),
  );
}

/** A V2 server of the given release at `url`; every other probe finds nothing. */
function v2At(url: string, serverVersion: string): (version: string, probed: string) => Probe {
  return (version, probed) =>
    version === "v2" && probed === url
      ? { kind: "found", version: "v2", serverVersion }
      : { kind: "none" };
}

function errorMessage(): string {
  return mocked.loggerErrorMock.mock.calls[0]?.[0] as string;
}

describe("opencode/local-start", () => {
  beforeEach(() => {
    __resetServerHealthStateForTests();
    __resetOpencodeServerTargetForTests();
    mocked.serverVersion = "v2";
    mocked.probeMock.mockReset();
    mocked.probeMock.mockResolvedValue({ kind: "none" });
    mocked.findRegisteredMock.mockReset();
    mocked.findRegisteredMock.mockResolvedValue(null);
    mocked.readLocalVersionMock.mockReset();
    mocked.readLocalVersionMock.mockResolvedValue("2.0.16");
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  it("starts when nothing answers and the executable matches", async () => {
    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "start",
    });
    expect(mocked.loggerErrorMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).not.toHaveBeenCalled();
  });

  it("keeps a slow configured server that answers the probe and skips the registry", async () => {
    answerProbes(v2At(CONFIGURED_URL, "2.1.3"));
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "answers",
      version: "2.1.3",
    });
    expect(mocked.findRegisteredMock).not.toHaveBeenCalled();
    expect(isOnConfiguredOpencodeServer()).toBe(true);
  });

  it("refuses when the configured address rejects the credentials", async () => {
    answerProbes((version) => (version === "v2" ? { kind: "unauthorized" } : { kind: "none" }));
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "refuse",
    });
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Authentication failed"),
    );
    expect(mocked.findRegisteredMock).not.toHaveBeenCalled();
    expect(mocked.readLocalVersionMock).not.toHaveBeenCalled();
  });

  it("refuses when a server of the other version answers at the configured address", async () => {
    answerProbes((version) =>
      version === "v1"
        ? { kind: "found", version: "v1", serverVersion: "1.18.32" }
        : { kind: "none" },
    );
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "refuse",
    });
    expect(errorMessage()).toContain("OPENCODE_SERVER_VERSION=v2");
    expect(errorMessage()).toContain("OpenCode 1.18.32 (API v1)");
    expect(mocked.findRegisteredMock).not.toHaveBeenCalled();
  });

  it("connects to a registered V2 server on another port that answers with its credentials", async () => {
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);
    answerProbes(v2At(REGISTERED.url, "2.1.3"));

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "connected",
      url: REGISTERED.url,
      version: "2.1.3",
    });
    expect(mocked.probeMock).toHaveBeenCalledWith("v2", REGISTERED);
    expect(getActiveOpencodeServer()).toEqual(REGISTERED);
    expect(mocked.readLocalVersionMock).not.toHaveBeenCalled();
    expect(mocked.loggerErrorMock).not.toHaveBeenCalled();
  });

  it("refuses without switching or starting when the registered server rejects its credentials", async () => {
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);
    answerProbes((_version, url) =>
      url === REGISTERED.url ? { kind: "unauthorized" } : { kind: "none" },
    );

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "refuse",
    });
    expect(isOnConfiguredOpencodeServer()).toBe(true);
    expect(errorMessage()).toContain("http://127.0.0.1:49374");
    expect(errorMessage()).toContain("rejected the credentials");
    expect(errorMessage()).not.toContain("secret");
    expect(mocked.readLocalVersionMock).not.toHaveBeenCalled();
  });

  it("refuses without switching when the registered server does not answer", async () => {
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "refuse",
    });
    expect(isOnConfiguredOpencodeServer()).toBe(true);
    expect(errorMessage()).toContain("did not answer");
  });

  it("does not look for a registered server on V1", async () => {
    mocked.serverVersion = "v1";
    mocked.readLocalVersionMock.mockResolvedValue("1.18.32");
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "start",
    });
    expect(mocked.findRegisteredMock).not.toHaveBeenCalled();
  });

  it("starts when the registered V2 server is on the configured port", async () => {
    mocked.findRegisteredMock.mockResolvedValue({ url: "http://localhost:4097" });

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "start",
    });
    expect(isOnConfiguredOpencodeServer()).toBe(true);
  });

  describe("while switched to another server", () => {
    beforeEach(() => {
      switchOpencodeServer(REGISTERED);
    });

    it("stays on the switched server when it answers the probe", async () => {
      answerProbes(v2At(REGISTERED.url, "2.1.3"));

      await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
        kind: "answers",
        version: "2.1.3",
      });
      expect(getActiveOpencodeServer()).toEqual(REGISTERED);
    });

    it("moves back to the configured address when it answers again", async () => {
      answerProbes(v2At(CONFIGURED_URL, "2.1.4"));
      mocked.findRegisteredMock.mockResolvedValue({ url: "http://127.0.0.1:50000" });

      await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
        kind: "answers",
        version: "2.1.4",
      });
      expect(isOnConfiguredOpencodeServer()).toBe(true);
      expect(mocked.findRegisteredMock).not.toHaveBeenCalled();
    });

    it("moves to a new registered server when neither the switched nor the configured one answers", async () => {
      const next = { url: "http://127.0.0.1:50000" };
      mocked.findRegisteredMock.mockResolvedValue(next);
      answerProbes(v2At(next.url, "2.1.4"));

      await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
        kind: "connected",
        url: next.url,
        version: "2.1.4",
      });
      expect(getActiveOpencodeServer()).toEqual(next);
    });

    it("moves back to the configured address before a start when nothing answers", async () => {
      await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
        kind: "start",
      });
      expect(isOnConfiguredOpencodeServer()).toBe(true);
    });

    it("stays on the switched server when the start is refused", async () => {
      mocked.readLocalVersionMock.mockResolvedValue("1.18.32");

      await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
        kind: "refuse",
      });
      expect(getActiveOpencodeServer()).toEqual(REGISTERED);
    });
  });

  it("refuses when the local opencode executable is the other version", async () => {
    mocked.serverVersion = "v1";
    mocked.readLocalVersionMock.mockResolvedValue("2.0.16");

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "refuse",
    });
    expect(errorMessage()).toContain("OPENCODE_SERVER_VERSION=v1");
    expect(errorMessage()).toContain("local opencode executable is OpenCode 2.0.16 (API v2)");
    expect(errorMessage()).toContain("Set OPENCODE_SERVER_VERSION=v2");
  });

  it("starts when the executable version cannot be read", async () => {
    mocked.readLocalVersionMock.mockResolvedValue(null);

    await expect(resolveUnavailableOpencodeServer(TARGET, "always")).resolves.toEqual({
      kind: "start",
    });
  });

  it("logs a repeated refusal once in once mode and every time in always mode", async () => {
    mocked.findRegisteredMock.mockResolvedValue(REGISTERED);

    await resolveUnavailableOpencodeServer(TARGET, "once");
    await resolveUnavailableOpencodeServer(TARGET, "once");
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(1);

    await resolveUnavailableOpencodeServer(TARGET, "always");
    expect(mocked.loggerErrorMock).toHaveBeenCalledTimes(2);
  });
});
