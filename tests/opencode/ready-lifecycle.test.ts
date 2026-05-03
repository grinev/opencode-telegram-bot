import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
  },
}));

import { opencodeReadyLifecycle } from "../../src/opencode/ready-lifecycle.js";

describe("opencode/ready-lifecycle", () => {
  beforeEach(() => {
    opencodeReadyLifecycle.__resetForTests();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
  });

  it("calls ready handlers on unavailable to ready transition", async () => {
    const handler = vi.fn();
    opencodeReadyLifecycle.onReady(handler);

    const emitted = await opencodeReadyLifecycle.notifyReady("startup");

    expect(emitted).toBe(true);
    expect(handler).toHaveBeenCalledWith("startup");
  });

  it("does not call handlers for repeated ready notification", async () => {
    const handler = vi.fn();
    opencodeReadyLifecycle.onReady(handler);

    await opencodeReadyLifecycle.notifyReady("first");
    const emitted = await opencodeReadyLifecycle.notifyReady("second");

    expect(emitted).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("unavailable resets state for the next ready notification", async () => {
    const handler = vi.fn();
    opencodeReadyLifecycle.onReady(handler);

    await opencodeReadyLifecycle.notifyReady("first");
    opencodeReadyLifecycle.notifyUnavailable("offline");
    await opencodeReadyLifecycle.notifyReady("second");

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("logs handler errors and continues running remaining handlers", async () => {
    const failingHandler = vi.fn().mockRejectedValue(new Error("boom"));
    const nextHandler = vi.fn();
    opencodeReadyLifecycle.onReady(failingHandler);
    opencodeReadyLifecycle.onReady(nextHandler);

    await opencodeReadyLifecycle.notifyReady("startup");

    expect(nextHandler).toHaveBeenCalledWith("startup");
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[OpenCodeReady] Ready handler failed: reason=startup",
      expect.any(Error),
    );
  });
});
