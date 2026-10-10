import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHealthcheck } from "../../src/runtime/healthcheck.js";

function listen(statusCode: number): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(req.url === "/health/live" ? statusCode : 404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function freePort(): Promise<number> {
  const { server, port } = await listen(200);
  await close(server);
  return port;
}

describe("runtime/healthcheck", () => {
  let tempDir: string;
  let envFilePath: string;
  const outsideContainer = () => false;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "healthcheck-"));
    envFilePath = path.join(tempDir, ".env");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("passes without a request when the endpoint is off", async () => {
    const code = await runHealthcheck({
      env: { BOT_HEALTH_PORT: "0" },
      envFilePath,
      dockerEnvExists: () => true,
    });

    expect(code).toBe(0);
  });

  it("passes when /health/live answers 200", async () => {
    const { server, port } = await listen(200);
    try {
      const code = await runHealthcheck({
        env: { BOT_HEALTH_PORT: String(port) },
        envFilePath,
        dockerEnvExists: outsideContainer,
      });

      expect(code).toBe(0);
    } finally {
      await close(server);
    }
  });

  it("fails when /health/live answers anything but 200", async () => {
    const { server, port } = await listen(503);
    try {
      const code = await runHealthcheck({
        env: { BOT_HEALTH_PORT: String(port) },
        envFilePath,
        dockerEnvExists: outsideContainer,
      });

      expect(code).toBe(1);
    } finally {
      await close(server);
    }
  });

  it("fails when nothing listens on the port", async () => {
    const port = await freePort();

    const code = await runHealthcheck({
      env: { BOT_HEALTH_PORT: String(port) },
      envFilePath,
      dockerEnvExists: outsideContainer,
    });

    expect(code).toBe(1);
  });

  it("takes the port from the runtime .env when the process env has none", async () => {
    const { server, port } = await listen(200);
    await writeFile(envFilePath, `BOT_HEALTH_PORT=${port}\n`);
    try {
      const code = await runHealthcheck({
        env: {},
        envFilePath,
        dockerEnvExists: outsideContainer,
      });

      expect(code).toBe(0);
    } finally {
      await close(server);
    }
  });

  it("lets the process env win over the runtime .env", async () => {
    await writeFile(envFilePath, "BOT_HEALTH_PORT=1\n");

    const code = await runHealthcheck({
      env: { BOT_HEALTH_PORT: "0" },
      envFilePath,
      dockerEnvExists: outsideContainer,
    });

    expect(code).toBe(0);
  });
});
