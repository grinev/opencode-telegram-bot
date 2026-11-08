import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createGatewayRequestHandler } from "../src/http-server.js";
import { ReadinessCoordinator } from "../src/readiness.js";
import type { GatewayConfig } from "../src/types.js";

const secret = "test-secret";

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return address!.port;
}

function url(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

test("protects control and proxy routes while leaving liveness public", async (t) => {
  const target = http.createServer((req, res) => {
    if (req.url === "/global/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ healthy: true, version: "test-version" }));
      return;
    }
    if (req.url === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: {\"type\":\"server.connected\"}\n\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        gatewaySecret: req.headers["x-gateway-secret"],
      }),
    );
  });
  const targetPort = await listen(target);
  t.after(() => target.close());

  const config: GatewayConfig = {
    bindHost: "127.0.0.1",
    port: 0,
    targetIp: "127.0.0.1",
    targetPort,
    gatewaySecret: secret,
    wolMacAddress: "aa:bb:cc:dd:ee:ff",
    wolBroadcastAddress: "127.0.0.1",
    readinessTimeoutMs: 100,
    readinessPollIntervalMs: 1,
    readinessProbeTimeoutMs: 50,
  };
  const readiness = new ReadinessCoordinator(config, undefined, {
    send: async () => assert.fail("ready target must not be woken"),
  });
  const gateway = http.createServer(createGatewayRequestHandler(config, readiness, Date.now()));
  const gatewayPort = await listen(gateway);
  t.after(() => gateway.close());

  const live = await fetch(url(gatewayPort, "/health/live"));
  assert.equal(live.status, 200);

  const unauthorized = await fetch(url(gatewayPort, "/status"));
  assert.equal(unauthorized.status, 401);

  const headers = { "X-Gateway-Secret": secret };
  const status = await fetch(url(gatewayPort, "/status"), { headers });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).opencode.version, "test-version");

  const proxied = await fetch(url(gatewayPort, "/events"), { headers });
  assert.equal(proxied.status, 200);
  assert.equal(proxied.headers.get("content-type"), "text/event-stream");
  assert.match(await proxied.text(), /server\.connected/);

  const forwarded = await fetch(url(gatewayPort, "/forwarded?value=1"), { headers });
  assert.deepEqual(await forwarded.json(), {
    method: "GET",
    url: "/forwarded?value=1",
  });

  const wake = await fetch(url(gatewayPort, "/wake"), { method: "POST", headers });
  assert.equal(wake.status, 200);
  assert.equal((await wake.json()).woke, false);
});
