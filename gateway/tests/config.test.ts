import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    TARGET_IP_ADDRESS: "127.0.0.1",
    TARGET_MAC_ADDRESS: "aa:bb:cc:dd:ee:ff",
    WOL_BROADCAST_ADDRESS: "255.255.255.255",
    GATEWAY_SHARED_SECRET: "test-secret",
    ...overrides,
  };
}

test("loads and normalizes valid gateway configuration", () => {
  const config = loadConfig(
    environment({
      TARGET_MAC_ADDRESS: "AA-BB-CC-DD-EE-FF",
      TARGET_OPENCODE_PORT: "4097",
      READINESS_TIMEOUT_MS: "5000",
    }),
  );

  assert.equal(config.targetIp, "127.0.0.1");
  assert.equal(config.targetPort, 4097);
  assert.equal(config.wolMacAddress, "aa:bb:cc:dd:ee:ff");
  assert.equal(config.readinessTimeoutMs, 5000);
});

test("rejects invalid target and WOL configuration", () => {
  assert.throws(
    () => loadConfig(environment({ TARGET_IP_ADDRESS: "not-an-ip" })),
    /TARGET_IP_ADDRESS must be a valid IP address/,
  );
  assert.throws(
    () => loadConfig(environment({ TARGET_MAC_ADDRESS: "aa:bb:cc:dd:ee" })),
    /TARGET_MAC_ADDRESS/,
  );
  assert.throws(
    () => loadConfig(environment({ WOL_BROADCAST_ADDRESS: "::1" })),
    /WOL_BROADCAST_ADDRESS must be a valid IPv4 address/,
  );
});

test("rejects a missing shared secret", () => {
  const env = environment();
  delete env.GATEWAY_SHARED_SECRET;

  assert.throws(() => loadConfig(env), /GATEWAY_SHARED_SECRET/);
});
