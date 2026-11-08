import http from "node:http";
import type { GatewayConfig } from "./types.js";
import type { ReadinessCoordinator } from "./readiness.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "expect",
  "x-gateway-secret",
]);

function json(res: http.ServerResponse, statusCode: number, data: unknown): void {
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

function proxyHeaders(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(name)) {
      continue;
    }
    if (typeof value === "string" || Array.isArray(value)) {
      headers[name] = value;
    }
  }
  return headers;
}

function responseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const filtered: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(name)) {
      continue;
    }
    if (typeof value === "string" || Array.isArray(value)) {
      filtered[name] = value;
    }
  }
  return filtered;
}

function validProxyPath(path: string | undefined): path is string {
  return Boolean(path && path.startsWith("/") && !path.startsWith("//"));
}

export async function proxyOpenCodeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: GatewayConfig,
  readiness: ReadinessCoordinator,
): Promise<void> {
  if (!validProxyPath(req.url)) {
    req.resume();
    json(res, 400, { error: "Invalid request path" });
    return;
  }

  const wakeResult = await readiness.ensureReady();
  if (!wakeResult.ready) {
    req.resume();
    json(res, 503, {
      error: wakeResult.error ?? "OpenCode target is not ready",
      readiness: wakeResult.snapshot,
    });
    return;
  }

  const upstream = http.request({
    hostname: config.targetIp,
    port: config.targetPort,
    method: req.method,
    path: req.url,
    headers: proxyHeaders(req),
    timeout: 0,
  });

  let upstreamConnected = false;
  upstream.once("response", (upstreamResponse) => {
    upstreamConnected = true;
    res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders(upstreamResponse.headers));
    upstreamResponse.pipe(res);
  });

  upstream.once("error", (error) => {
    if (!upstreamConnected) {
      json(res, 502, { error: `OpenCode proxy failed: ${error.message}` });
    } else {
      res.destroy(error);
    }
  });

  req.once("aborted", () => upstream.destroy());
  res.once("close", () => {
    if (!res.writableEnded) {
      upstream.destroy();
    }
  });
  req.pipe(upstream);
}
