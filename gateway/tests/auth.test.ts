import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import { hasValidGatewaySecret } from "../src/auth.js";

function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as IncomingMessage;
}

test("accepts the exact shared secret", () => {
  assert.equal(hasValidGatewaySecret(request({ "x-gateway-secret": "secret" }), "secret"), true);
  assert.equal(hasValidGatewaySecret(request({ "x-gateway-secret": "wrong" }), "secret"), false);
  assert.equal(hasValidGatewaySecret(request({}), "secret"), false);
});

test("rejects multiple secret header values", () => {
  assert.equal(
    hasValidGatewaySecret(
      { headers: { "x-gateway-secret": ["secret", "secret"] } } as unknown as IncomingMessage,
      "secret",
    ),
    false,
  );
});
