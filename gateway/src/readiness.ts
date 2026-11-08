import type { GatewayConfig, ReadinessSnapshot, WakeResult } from "./types.js";
import { sendWakeOnLan } from "./wol.js";

export interface ReadinessProbe {
  check(): Promise<ReadinessSnapshot>;
}

export interface WakeSender {
  send(): Promise<void>;
}

interface HealthResponse {
  healthy?: unknown;
  version?: unknown;
}

function targetUrl(config: GatewayConfig): string {
  const host = config.targetIp.includes(":") ? `[${config.targetIp}]` : config.targetIp;
  return `http://${host}:${config.targetPort}/global/health`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class OpenCodeReadinessProbe implements ReadinessProbe {
  constructor(private readonly config: GatewayConfig) {}

  async check(): Promise<ReadinessSnapshot> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();

    try {
      const response = await fetch(targetUrl(this.config), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.config.readinessProbeTimeoutMs),
      });
      const authenticationRequired = response.status === 401;
      let body: HealthResponse | null = null;

      if (response.headers.get("content-type")?.includes("json")) {
        try {
          body = (await response.json()) as HealthResponse;
        } catch {
          body = null;
        }
      }

      const healthy = body?.healthy === true;
      const ready = healthy || authenticationRequired;
      const version = typeof body?.version === "string" ? body.version : undefined;

      return {
        checkedAt,
        latencyMs: Date.now() - startedAt,
        targetReachable: true,
        openCodeReachable: true,
        healthy: ready,
        authenticationRequired,
        statusCode: response.status,
        ...(version ? { version } : {}),
        ...(!ready ? { error: `OpenCode health check returned HTTP ${response.status}` } : {}),
      };
    } catch (error) {
      return {
        checkedAt,
        latencyMs: Date.now() - startedAt,
        targetReachable: false,
        openCodeReachable: false,
        healthy: false,
        authenticationRequired: false,
        error: errorMessage(error),
      };
    }
  }
}

export class ReadinessCoordinator {
  private inFlight: Promise<WakeResult> | null = null;
  private lastSnapshot: ReadinessSnapshot | null = null;
  private lastWakeAt: string | undefined;
  private lastWakeDurationMs: number | undefined;
  private stopped = false;
  private activeAbortController: AbortController | null = null;
  private readonly wakeSender: WakeSender;

  constructor(
    private readonly config: GatewayConfig,
    private readonly probe: ReadinessProbe = new OpenCodeReadinessProbe(config),
    wakeSender: WakeSender = { send: () => sendWakeOnLan(config) },
  ) {
    this.wakeSender = wakeSender;
  }

  async check(): Promise<ReadinessSnapshot> {
    const snapshot = await this.probe.check();
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  async ensureReady(): Promise<WakeResult> {
    if (this.stopped) {
      return this.stoppedResult("Gateway is shutting down");
    }

    const current = await this.check();
    if (current.healthy) {
      return { ready: true, woke: false, wakeDurationMs: 0, snapshot: current };
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const operation = this.wakeAndWait();
    this.inFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    }
  }

  async status(): Promise<{
    snapshot: ReadinessSnapshot;
    wakeInProgress: boolean;
    lastWakeAt?: string;
    lastWakeDurationMs?: number;
  }> {
    const snapshot = await this.check();
    return {
      snapshot,
      wakeInProgress: this.inFlight !== null,
      ...(this.lastWakeAt ? { lastWakeAt: this.lastWakeAt } : {}),
      ...(this.lastWakeDurationMs !== undefined
        ? { lastWakeDurationMs: this.lastWakeDurationMs }
        : {}),
    };
  }

  stop(): void {
    this.stopped = true;
    this.activeAbortController?.abort();
  }

  private async wakeAndWait(): Promise<WakeResult> {
    if (this.stopped) {
      return this.stoppedResult("Gateway is shutting down");
    }

    const startedAt = Date.now();
    const wakeAt = new Date().toISOString();
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    try {
      try {
        await this.wakeSender.send();
      } catch (error) {
        const snapshot = this.lastSnapshot ?? (await this.check());
        const message = `Wake-on-LAN failed: ${errorMessage(error)}`;
        this.lastSnapshot = { ...snapshot, error: message };
        this.lastWakeAt = wakeAt;
        this.lastWakeDurationMs = Date.now() - startedAt;
        return {
          ready: false,
          woke: true,
          wakeDurationMs: this.lastWakeDurationMs,
          snapshot: this.lastSnapshot,
          error: message,
        };
      }

      const deadline = Date.now() + this.config.readinessTimeoutMs;
      while (!this.stopped && !abortController.signal.aborted && Date.now() <= deadline) {
        const snapshot = await this.check();
        if (snapshot.healthy) {
          this.lastWakeAt = wakeAt;
          this.lastWakeDurationMs = Date.now() - startedAt;
          return {
            ready: true,
            woke: true,
            wakeDurationMs: this.lastWakeDurationMs,
            snapshot,
          };
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          break;
        }
        const completed = await waitWithAbort(
          Math.min(this.config.readinessPollIntervalMs, remainingMs),
          abortController.signal,
        );
        if (!completed) {
          break;
        }
      }

      const snapshot = this.lastSnapshot ?? (await this.check());
      const error = this.stopped
        ? "Gateway is shutting down"
        : `OpenCode did not become ready within ${this.config.readinessTimeoutMs}ms`;
      this.lastWakeAt = wakeAt;
      this.lastWakeDurationMs = Date.now() - startedAt;
      this.lastSnapshot = { ...snapshot, error };
      return {
        ready: false,
        woke: true,
        wakeDurationMs: this.lastWakeDurationMs,
        snapshot: this.lastSnapshot,
        error,
      };
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

  private stoppedResult(error: string): WakeResult {
    const snapshot = this.lastSnapshot ?? {
      checkedAt: new Date().toISOString(),
      latencyMs: 0,
      targetReachable: false,
      openCodeReachable: false,
      healthy: false,
      authenticationRequired: false,
      error,
    };
    return { ready: false, woke: false, wakeDurationMs: 0, snapshot, error };
  }
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
