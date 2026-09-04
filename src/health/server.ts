import http from "node:http";
import { isOpencodeServerHealthy } from "../opencode/ready-refresh.js";
import { logger } from "../utils/logger.js";

let server: http.Server | null = null;
let startTimeMs: number | null = null;
let botVersion = "unknown";

interface HealthPayload {
  status: "healthy" | "degraded";
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    process: { healthy: boolean };
    opencode: { healthy: boolean; latencyMs: number | null; error?: string };
  };
}

function getUptimeSeconds(): number {
  if (startTimeMs === null) return 0;
  return Math.floor((Date.now() - startTimeMs) / 1000);
}

async function checkOpencodeWithTimeout(timeoutMs = 3000): Promise<{ healthy: boolean; latencyMs: number | null; error?: string }> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      isOpencodeServerHealthy(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return { healthy: result === true, latencyMs: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { healthy: false, latencyMs: Date.now() - start, error: message };
  }
}

async function buildHealthPayload(): Promise<HealthPayload> {
  const opencode = await checkOpencodeWithTimeout(3000);

  let status: HealthPayload["status"] = "healthy";
  if (!opencode.healthy) {
    // Bot process alive but dependency down -> degraded (still running, can recover)
    status = "degraded";
  }

  return {
    status,
    version: botVersion,
    uptimeSeconds: getUptimeSeconds(),
    timestamp: new Date().toISOString(),
    checks: {
      process: { healthy: true },
      opencode,
    },
  };
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export async function startHealthServer(port: number, version: string): Promise<void> {
  if (port === 0) {
    logger.info("[Health] Health server disabled (BOT_HEALTH_PORT=0)");
    return;
  }
  if (server) {
    logger.warn("[Health] Health server already running");
    return;
  }

  botVersion = version;
  startTimeMs = Date.now();

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const path = url.pathname;

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    if (path === "/health/live") {
      // Liveness: process is alive (no dependency checks)
      sendJson(res, 200, {
        status: "healthy",
        version: botVersion,
        uptimeSeconds: getUptimeSeconds(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (path === "/health/ready") {
      // Readiness: 200 if healthy, 503 if degraded
      const payload = await buildHealthPayload();
      sendJson(res, payload.status === "healthy" ? 200 : 503, payload);
      return;
    }

    if (path === "/health") {
      // Full health: always 200 with status field (Docker healthcheck convention)
      const payload = await buildHealthPayload();
      sendJson(res, 200, payload);
      return;
    }

    sendJson(res, 404, { error: "Not found", path });
  });

  server.on("error", (error) => {
    logger.error("[Health] Health server error", error);
  });

  await new Promise<void>((resolve, reject) => {
    server!.listen(port, "127.0.0.1", () => {
      logger.info(`[Health] Health server listening on 127.0.0.1:${port} (/health, /health/live, /health/ready)`);
      resolve();
    });
    server!.once("error", reject);
  });
}

export async function stopHealthServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  startTimeMs = null;
  await new Promise<void>((resolve) => {
    s.close(() => resolve());
    setTimeout(() => {
      s.closeAllConnections?.();
      resolve();
    }, 2000).unref?.();
  });
  logger.info("[Health] Health server stopped");
}