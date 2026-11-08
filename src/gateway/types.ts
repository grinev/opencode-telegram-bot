export interface GatewayStatusResponse {
  status: "healthy" | "degraded";
  uptimeSeconds: number;
  timestamp: string;
  target: {
    ip: string;
    port: number;
    reachable: boolean;
  };
  opencode: {
    reachable: boolean;
    healthy: boolean;
    authenticationRequired: boolean;
    version?: string;
    statusCode?: number;
  };
  readiness: {
    checkedAt: string;
    latencyMs: number;
    wakeInProgress: boolean;
    lastWakeAt?: string;
    lastWakeDurationMs?: number;
    error?: string;
  };
}

export interface GatewayWakeResponse {
  ready: boolean;
  woke: boolean;
  wakeDurationMs: number;
  snapshot: {
    checkedAt: string;
    latencyMs: number;
    targetReachable: boolean;
    openCodeReachable: boolean;
    healthy: boolean;
    authenticationRequired: boolean;
    version?: string;
    statusCode?: number;
    error?: string;
  };
  error?: string;
}

export type GatewayMonitorCheckName = "gateway" | "target" | "opencode" | "wake";

export interface GatewayMonitorCheckState {
  healthy: boolean | null;
  message: string;
  updatedAt: string;
  lastFailureAlertAt?: string;
}

export interface GatewayAlert {
  kind: "failure" | "recovery";
  check: GatewayMonitorCheckName;
  message: string;
  createdAt: string;
}

export interface GatewayMonitoringState {
  lastRunAt?: string;
  checks: Partial<Record<GatewayMonitorCheckName, GatewayMonitorCheckState>>;
  alerts: GatewayAlert[];
}
