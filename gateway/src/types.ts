export interface GatewayConfig {
  bindHost: string;
  port: number;
  targetIp: string;
  targetPort: number;
  gatewaySecret: string;
  wolMacAddress: string;
  wolBroadcastAddress: string;
  wolInterface?: string;
  readinessTimeoutMs: number;
  readinessPollIntervalMs: number;
  readinessProbeTimeoutMs: number;
}

export interface ReadinessSnapshot {
  checkedAt: string;
  latencyMs: number;
  targetReachable: boolean;
  openCodeReachable: boolean;
  healthy: boolean;
  authenticationRequired: boolean;
  version?: string;
  statusCode?: number;
  error?: string;
}

export interface WakeResult {
  ready: boolean;
  woke: boolean;
  wakeDurationMs: number;
  snapshot: ReadinessSnapshot;
  error?: string;
}

export interface GatewayStatus {
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
