import http from "node:http";
import { hasValidGatewaySecret } from "./auth.js";
import { logger } from "./logger.js";
import { proxyOpenCodeRequest } from "./proxy.js";
import type { ReadinessCoordinator } from "./readiness.js";
import type { GatewayConfig, GatewayStatus, ReadinessSnapshot, WakeResult } from "./types.js";

const CLOSE_CONNECTIONS_TIMEOUT_MS = 2_000;

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function methodNotAllowed(res: http.ServerResponse): void {
  sendJson(res, 405, { error: "Method not allowed" });
}

function unauthorized(res: http.ServerResponse): void {
  sendJson(res, 401, { error: "Unauthorized" });
}

function statusCodeForWake(result: WakeResult): number {
  if (result.ready) {
    return 200;
  }
  return result.error?.startsWith("Wake-on-LAN failed") ? 502 : 504;
}

function toGatewayStatus(
  config: GatewayConfig,
  startedAt: number,
  readiness: {
    snapshot: ReadinessSnapshot;
    wakeInProgress: boolean;
    lastWakeAt?: string;
    lastWakeDurationMs?: number;
  },
): GatewayStatus {
  const { snapshot } = readiness;
  return {
    status: snapshot.healthy ? "healthy" : "degraded",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    target: {
      ip: config.targetIp,
      port: config.targetPort,
      reachable: snapshot.targetReachable,
    },
    opencode: {
      reachable: snapshot.openCodeReachable,
      healthy: snapshot.healthy,
      authenticationRequired: snapshot.authenticationRequired,
      ...(snapshot.version ? { version: snapshot.version } : {}),
      ...(snapshot.statusCode !== undefined ? { statusCode: snapshot.statusCode } : {}),
    },
    readiness: {
      checkedAt: snapshot.checkedAt,
      latencyMs: snapshot.latencyMs,
      wakeInProgress: readiness.wakeInProgress,
      ...(readiness.lastWakeAt ? { lastWakeAt: readiness.lastWakeAt } : {}),
      ...(readiness.lastWakeDurationMs !== undefined
        ? { lastWakeDurationMs: readiness.lastWakeDurationMs }
        : {}),
      ...(snapshot.error ? { error: snapshot.error } : {}),
    },
  };
}

export function createGatewayRequestHandler(
  config: GatewayConfig,
  readiness: ReadinessCoordinator,
  startedAt: number,
): http.RequestListener {
  return (req, res) => {
    void handleRequest(req, res, config, readiness, startedAt).catch((error: unknown) => {
      logger.error("Unhandled request error", error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Gateway request failed" });
      } else {
        res.destroy();
      }
    });
  };
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: GatewayConfig,
  readiness: ReadinessCoordinator,
  startedAt: number,
): Promise<void> {
  const path = (req.url ?? "/").split("?", 1)[0];

  if (path === "/health/live") {
    if (req.method !== "GET") {
      methodNotAllowed(res);
      return;
    }
    sendJson(res, 200, {
      status: "healthy",
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (!hasValidGatewaySecret(req, config.gatewaySecret)) {
    req.resume();
    unauthorized(res);
    return;
  }

  if (path === "/status") {
    if (req.method !== "GET") {
      methodNotAllowed(res);
      return;
    }
    const current = await readiness.status();
    sendJson(res, 200, toGatewayStatus(config, startedAt, current));
    return;
  }

  if (path === "/wake") {
    if (req.method !== "POST") {
      methodNotAllowed(res);
      return;
    }
    req.resume();
    const result = await readiness.ensureReady();
    sendJson(res, statusCodeForWake(result), result);
    return;
  }

  await proxyOpenCodeRequest(req, res, config, readiness);
}

export class GatewayHttpServer {
  private server: http.Server | null = null;
  private readonly startedAt = Date.now();

  constructor(
    private readonly config: GatewayConfig,
    private readonly readiness: ReadinessCoordinator,
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      throw new Error("Gateway server is already running");
    }

    const server = http.createServer(
      createGatewayRequestHandler(this.config, this.readiness, this.startedAt),
    );
    server.requestTimeout = 0;
    server.timeout = 0;
    server.keepAliveTimeout = 65_000;
    this.server = server;

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.config.port, this.config.bindHost, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      this.server = null;
      throw error;
    }

    server.on("error", (error) => logger.error("HTTP server error", error));
    logger.info(`Listening on ${this.config.bindHost}:${this.config.port}`);
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }

    this.server = null;
    this.readiness.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(() => {
        server.closeAllConnections();
        resolve();
      }, CLOSE_CONNECTIONS_TIMEOUT_MS).unref();
    });
    logger.info("Stopped");
  }
}
