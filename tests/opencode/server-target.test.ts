import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  loggerInfoMock: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: {
      apiUrl: "http://127.0.0.1:49374",
      username: "opencode",
      password: "configured-secret",
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: mocked.loggerInfoMock,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  __resetOpencodeServerTargetForTests,
  describeOpencodeServerUrl,
  getActiveOpencodeServer,
  isOnConfiguredOpencodeServer,
  switchOpencodeServer,
} from "../../src/opencode/server-target.js";

const CONFIGURED = {
  url: "http://127.0.0.1:49374",
  username: "opencode",
  password: "configured-secret",
};
const REGISTERED = { url: "http://127.0.0.1:28894", username: "opencode", password: "secret" };

describe("opencode/server-target", () => {
  beforeEach(() => {
    __resetOpencodeServerTargetForTests();
    mocked.loggerInfoMock.mockReset();
  });

  it("talks to the configured server by default", () => {
    expect(getActiveOpencodeServer()).toEqual(CONFIGURED);
    expect(isOnConfiguredOpencodeServer()).toBe(true);
  });

  it("switches to another server with one INFO line naming both addresses and no password", () => {
    switchOpencodeServer(REGISTERED);

    expect(getActiveOpencodeServer()).toEqual(REGISTERED);
    expect(isOnConfiguredOpencodeServer()).toBe(false);
    expect(mocked.loggerInfoMock).toHaveBeenCalledTimes(1);
    const message = mocked.loggerInfoMock.mock.calls[0]?.[0] as string;
    expect(message).toContain("http://127.0.0.1:49374");
    expect(message).toContain("http://127.0.0.1:28894");
    expect(message).not.toContain("secret");
  });

  it("logs nothing when the server does not change", () => {
    switchOpencodeServer(null);
    switchOpencodeServer(REGISTERED);
    switchOpencodeServer({ ...REGISTERED });

    expect(mocked.loggerInfoMock).toHaveBeenCalledTimes(1);
  });

  it("switches back to the configured server", () => {
    switchOpencodeServer(REGISTERED);
    switchOpencodeServer(null);

    expect(getActiveOpencodeServer()).toEqual(CONFIGURED);
    expect(isOnConfiguredOpencodeServer()).toBe(true);
    expect(mocked.loggerInfoMock).toHaveBeenCalledTimes(2);
  });

  it("uses a server without credentials without the configured password", () => {
    switchOpencodeServer({ url: "http://127.0.0.1:28894" });

    expect(getActiveOpencodeServer()).toEqual({ url: "http://127.0.0.1:28894" });
  });

  it("describes an address without credentials written into it", () => {
    expect(describeOpencodeServerUrl("http://user:secret@127.0.0.1:4096")).toBe(
      "http://127.0.0.1:4096",
    );
  });
});
