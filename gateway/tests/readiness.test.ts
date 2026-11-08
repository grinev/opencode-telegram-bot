import assert from "node:assert/strict";
import test from "node:test";
import { ReadinessCoordinator, type ReadinessProbe, type WakeSender } from "../src/readiness.js";
import type { GatewayConfig, ReadinessSnapshot } from "../src/types.js";

const config: GatewayConfig = {
  bindHost: "127.0.0.1",
  port: 4096,
  targetIp: "127.0.0.1",
  targetPort: 4096,
  gatewaySecret: "secret",
  wolMacAddress: "aa:bb:cc:dd:ee:ff",
  wolBroadcastAddress: "127.0.0.1",
  readinessTimeoutMs: 100,
  readinessPollIntervalMs: 1,
  readinessProbeTimeoutMs: 10,
};

function snapshot(healthy: boolean): ReadinessSnapshot {
  return {
    checkedAt: new Date().toISOString(),
    latencyMs: 1,
    targetReachable: healthy,
    openCodeReachable: healthy,
    healthy,
    authenticationRequired: false,
    ...(healthy ? { version: "test-version", statusCode: 200 } : { error: "offline" }),
  };
}

test("does not wake an already-ready target", async () => {
  const sender: WakeSender = { send: async () => assert.fail("WOL should not be sent") };
  const probe: ReadinessProbe = { check: async () => snapshot(true) };
  const coordinator = new ReadinessCoordinator(config, probe, sender);

  const result = await coordinator.ensureReady();

  assert.equal(result.ready, true);
  assert.equal(result.woke, false);
});

test("shares one WOL/readiness operation across concurrent callers", async () => {
  let checks = 0;
  let sends = 0;
  const probe: ReadinessProbe = {
    check: async () => {
      checks++;
      return snapshot(checks >= 3);
    },
  };
  const sender: WakeSender = { send: async () => { sends++; } };
  const coordinator = new ReadinessCoordinator(config, probe, sender);

  const [first, second] = await Promise.all([
    coordinator.ensureReady(),
    coordinator.ensureReady(),
  ]);

  assert.equal(sends, 1);
  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.equal(first.woke, true);
  assert.equal(second.woke, true);
});

test("returns a bounded timeout when the target never becomes ready", async () => {
  let sends = 0;
  const probe: ReadinessProbe = { check: async () => snapshot(false) };
  const sender: WakeSender = { send: async () => { sends++; } };
  const coordinator = new ReadinessCoordinator(config, probe, sender);

  const result = await coordinator.ensureReady();

  assert.equal(sends, 1);
  assert.equal(result.ready, false);
  assert.match(result.error ?? "", /did not become ready/);
});

test("cancels a pending readiness wait on shutdown", async () => {
  const longConfig = { ...config, readinessTimeoutMs: 10_000, readinessPollIntervalMs: 10_000 };
  const probe: ReadinessProbe = { check: async () => snapshot(false) };
  const sender: WakeSender = { send: async () => undefined };
  const coordinator = new ReadinessCoordinator(longConfig, probe, sender);
  const resultPromise = coordinator.ensureReady();

  await new Promise<void>((resolve) => setImmediate(resolve));
  coordinator.stop();

  const result = await resultPromise;
  assert.equal(result.ready, false);
  assert.equal(result.error, "Gateway is shutting down");
});
