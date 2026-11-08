import { config } from "../config.js";
import type { GatewayStatusResponse, GatewayWakeResponse } from "./types.js";

export class GatewayClientError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "GatewayClientError";
  }
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGatewayStatus(value: unknown): value is GatewayStatusResponse {
  if (!isRecord(value) || (value.status !== "healthy" && value.status !== "degraded")) {
    return false;
  }
  const target = value.target;
  const opencode = value.opencode;
  const readiness = value.readiness;
  return (
    isRecord(target) &&
    typeof target.ip === "string" &&
    typeof target.port === "number" &&
    typeof target.reachable === "boolean" &&
    isRecord(opencode) &&
    typeof opencode.reachable === "boolean" &&
    typeof opencode.healthy === "boolean" &&
    typeof opencode.authenticationRequired === "boolean" &&
    isRecord(readiness) &&
    typeof readiness.checkedAt === "string" &&
    typeof readiness.latencyMs === "number" &&
    typeof readiness.wakeInProgress === "boolean"
  );
}

function isGatewayWake(value: unknown): value is GatewayWakeResponse {
  if (!isRecord(value) || typeof value.ready !== "boolean" || typeof value.woke !== "boolean") {
    return false;
  }
  return typeof value.wakeDurationMs === "number" && isRecord(value.snapshot);
}

export class GatewayClient {
  private readonly fetchImpl: FetchImplementation;

  constructor(
    private readonly baseUrl: string = config.gateway?.apiUrl ?? "",
    private readonly sharedSecret: string = config.gateway?.sharedSecret ?? "",
    options: { fetch?: FetchImplementation } = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  isConfigured(): boolean {
    return this.sharedSecret.length > 0;
  }

  async getStatus(signal?: AbortSignal): Promise<GatewayStatusResponse> {
    return this.request("/status", { method: "GET" }, isGatewayStatus, signal);
  }

  async wake(signal?: AbortSignal): Promise<GatewayWakeResponse> {
    return this.request("/wake", { method: "POST" }, isGatewayWake, signal);
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    validate: (value: unknown) => value is T,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new GatewayClientError("Gateway access is not configured");
    }

    const timeoutSignal = AbortSignal.timeout(config.gateway?.requestTimeoutMs ?? 10_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          "X-Gateway-Secret": this.sharedSecret,
        },
        signal: requestSignal,
      });
    } catch {
      if (requestSignal.aborted && timeoutSignal.aborted && !signal?.aborted) {
        throw new GatewayClientError("Gateway request timed out");
      }
      throw new GatewayClientError("Gateway is unavailable");
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = isRecord(body) && typeof body.error === "string" ? body.error : "Gateway request failed";
      throw new GatewayClientError(message, response.status);
    }
    if (!validate(body)) {
      throw new GatewayClientError("Gateway returned an invalid response");
    }
    return body;
  }
}
