import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatusResponse } from "../../src/gateway/types.js";

const mocked = vi.hoisted(() => ({
  state: undefined as unknown,
  getStateMock: vi.fn(),
  setStateMock: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  config: {
    opencode: {
      serverVersion: "v2",
    },
    gateway: {
      monitorEnabled: true,
      monitorIntervalSec: 60,
      alertCooldownSec: 300,
      wakeDurationThresholdMs: 120_000,
    },
  },
}));

vi.mock("../../src/app/stores/settings-store.js", () => ({
  getGatewayMonitoringState: mocked.getStateMock,
  setGatewayMonitoringState: mocked.setStateMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GatewayMonitor } from "../../src/gateway/monitor-service.js";

function status(overrides: Partial<GatewayStatusResponse> = {}): GatewayStatusResponse {
  return {
    uptimeSeconds: 10,
    timestamp: "2026-11-08T00:00:00.000Z",
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
    ...overrides,
  } as GatewayStatusResponse;
}

describe("GatewayMonitor", () => {
  beforeEach(() => {
    mocked.state = undefined;
    mocked.getStateMock.mockImplementation(() => mocked.state);
    mocked.setStateMock.mockImplementation(async (state: unknown) => {
      mocked.state = state;
    });
    vi.clearAllMocks();
  });

  it("alerts on a failed check and on its recovery", async () => {
    const client = {
      isConfigured: () => true,
      getStatus: vi.fn().mockResolvedValue(
        status({
          target: { ip: "10.0.0.10", port: 4096, reachable: false },
          opencode: { reachable: false, healthy: false, authenticationRequired: false },
        }),
      ),
    };
    const notifier = vi.fn().mockResolvedValue(undefined);
    const monitor = new GatewayMonitor(client as never);

    monitor.start(notifier);
    await vi.waitFor(() => expect(mocked.setStateMock).toHaveBeenCalledTimes(1));
    monitor.stop();
    expect(mocked.state).toMatchObject({
      checks: {
        target: { healthy: false },
        opencode: { healthy: false },
      },
    });

    client.getStatus.mockResolvedValue(status());
    monitor.start(notifier);
    await vi.waitFor(() => expect(mocked.setStateMock).toHaveBeenCalledTimes(2));
    monitor.stop();
    expect(mocked.state).toMatchObject({
      checks: {
        target: { healthy: true },
        opencode: { healthy: true },
      },
    });
    expect(notifier).toHaveBeenCalled();
  });
});
