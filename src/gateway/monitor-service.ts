import { config } from "../config.js";
import {
  getGatewayMonitoringState,
  setGatewayMonitoringState,
} from "../app/stores/settings-store.js";
import { logger } from "../utils/logger.js";
import { t } from "../i18n/index.js";
import { GatewayClient, GatewayClientError } from "./client.js";
import type {
  GatewayAlert,
  GatewayMonitorCheckName,
  GatewayMonitorCheckState,
  GatewayMonitoringState,
  GatewayStatusResponse,
} from "./types.js";

const MAX_ALERTS = 50;

export type GatewayAlertNotifier = (alert: GatewayAlert) => Promise<void>;

export interface GatewayMonitorSnapshot {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  state: GatewayMonitoringState;
}

const CHECK_LABEL_KEYS: Record<GatewayMonitorCheckName, "gateway.check.gateway" | "gateway.check.target" | "gateway.check.opencode" | "gateway.check.wake"> = {
  gateway: "gateway.check.gateway",
  target: "gateway.check.target",
  opencode: "gateway.check.opencode",
  wake: "gateway.check.wake",
};

export function formatGatewayAlert(alert: GatewayAlert): string {
  const check = t(CHECK_LABEL_KEYS[alert.check]);
  return alert.kind === "failure"
    ? t("gateway.alert.failure", { check, message: alert.message })
    : t("gateway.alert.recovery", { check, message: alert.message });
}

interface CheckEvaluation {
  name: GatewayMonitorCheckName;
  healthy: boolean | null;
  message: string;
}

function emptyState(): GatewayMonitoringState {
  return { checks: {}, alerts: [] };
}

function checkEvaluations(status: GatewayStatusResponse): CheckEvaluation[] {
  const wakeMessage =
    status.readiness.lastWakeDurationMs === undefined
      ? "no wake-up recorded"
      : `${status.readiness.lastWakeDurationMs}ms`;
  const wakeHealthy =
    status.readiness.lastWakeDurationMs === undefined ||
    status.readiness.lastWakeDurationMs <= config.gateway.wakeDurationThresholdMs;

  return [
    { name: "gateway", healthy: true, message: "gateway responded" },
    {
      name: "target",
      healthy: status.target.reachable,
      message: status.target.reachable ? "target is reachable" : "target is unreachable",
    },
    {
      name: "opencode",
      healthy: status.opencode.healthy,
      message: status.opencode.healthy ? "OpenCode is ready" : "OpenCode is not ready",
    },
    {
      name: "wake",
      healthy: wakeHealthy,
      message: wakeHealthy
        ? `wake-up duration: ${wakeMessage}`
        : `wake-up duration exceeded threshold: ${wakeMessage}`,
    },
  ];
}

function failureMessage(error: unknown): string {
  if (error instanceof GatewayClientError) {
    return error.message;
  }
  return "Gateway status check failed";
}

export class GatewayMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeAbortController: AbortController | null = null;
  private running = false;
  private inFlight = false;
  private notifier: GatewayAlertNotifier | null = null;

  constructor(private readonly client: GatewayClient) {}

  isEnabled(): boolean {
    return config.gateway.monitorEnabled;
  }

  start(notifier: GatewayAlertNotifier): void {
    if (!this.isEnabled() || !this.client.isConfigured() || this.running) {
      return;
    }

    this.notifier = notifier;
    this.running = true;
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, config.gateway.monitorIntervalSec * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    this.notifier = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.activeAbortController?.abort();
    this.activeAbortController = null;
  }

  snapshot(): GatewayMonitorSnapshot {
    return {
      enabled: this.isEnabled(),
      configured: this.client.isConfigured(),
      running: this.running,
      state: getGatewayMonitoringState() ?? emptyState(),
    };
  }

  async runOnce(): Promise<void> {
    if (!this.client.isConfigured() || this.inFlight) {
      return;
    }

    this.inFlight = true;
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    try {
      let evaluations: CheckEvaluation[];
      try {
        evaluations = checkEvaluations(await this.client.getStatus(abortController.signal));
      } catch (error) {
        const message = failureMessage(error);
        evaluations = [
          { name: "gateway", healthy: false, message },
          { name: "target", healthy: null, message: "not checked because gateway is unavailable" },
          { name: "opencode", healthy: null, message: "not checked because gateway is unavailable" },
          { name: "wake", healthy: null, message: "not checked because gateway is unavailable" },
        ];
      }

      const previous = getGatewayMonitoringState() ?? emptyState();
      const now = new Date().toISOString();
      const alerts: GatewayAlert[] = [];
      const checks = { ...previous.checks };

      for (const evaluation of evaluations) {
        const oldCheck = previous.checks[evaluation.name];
        const nextCheck: GatewayMonitorCheckState = {
          healthy: evaluation.healthy,
          message: evaluation.message,
          updatedAt: now,
          ...(oldCheck?.lastFailureAlertAt
            ? { lastFailureAlertAt: oldCheck.lastFailureAlertAt }
            : {}),
        };

        if (evaluation.healthy === false && oldCheck?.healthy !== false) {
          const cooldownPassed =
            !oldCheck?.lastFailureAlertAt ||
            Date.parse(now) - Date.parse(oldCheck.lastFailureAlertAt) >=
              config.gateway.alertCooldownSec * 1000;
          if (cooldownPassed) {
            alerts.push({
              kind: "failure",
              check: evaluation.name,
              message: evaluation.message,
              createdAt: now,
            });
            nextCheck.lastFailureAlertAt = now;
          }
        } else if (evaluation.healthy === true && oldCheck?.healthy === false) {
          alerts.push({
            kind: "recovery",
            check: evaluation.name,
            message: evaluation.message,
            createdAt: now,
          });
        }

        checks[evaluation.name] = nextCheck;
      }

      const nextState: GatewayMonitoringState = {
        lastRunAt: now,
        checks,
        alerts: [...previous.alerts, ...alerts].slice(-MAX_ALERTS),
      };
      await setGatewayMonitoringState(nextState);

      for (const alert of alerts) {
        if (!this.notifier || abortController.signal.aborted) {
          break;
        }
        try {
          await this.notifier(alert);
        } catch (error) {
          logger.warn("[GatewayMonitor] Failed to deliver alert", error);
        }
      }
    } finally {
      this.inFlight = false;
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }
}
