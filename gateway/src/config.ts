import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import type { GatewayConfig } from "./types.js";

const DEFAULT_SECRET_FILE = "/run/secrets/gateway_shared_secret";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new Error(`Missing required gateway configuration: ${name}`);
  }
  return normalized;
}

function positiveInteger(value: string | undefined, name: string, defaultValue: number): number {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return defaultValue;
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function port(value: string | undefined, name: string, defaultValue: number): number {
  const parsed = positiveInteger(value, name, defaultValue);
  if (parsed > 65535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }
  return parsed;
}

function ipAddress(value: string, name: string): string {
  if (net.isIP(value) === 0) {
    throw new Error(`${name} must be a valid IP address`);
  }
  return value;
}

function ipv4Address(value: string, name: string): string {
  if (net.isIP(value) !== 4) {
    throw new Error(`${name} must be a valid IPv4 address`);
  }
  return value;
}

function macAddress(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[:-]/g, "");
  if (!/^[0-9a-f]{12}$/.test(normalized)) {
    throw new Error("TARGET_MAC_ADDRESS must contain exactly six hexadecimal bytes");
  }
  return normalized.match(/.{2}/g)?.join(":") ?? normalized;
}

function validateWolInterface(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  if (net.isIP(normalized) === 4) {
    return normalized;
  }

  const address = os.networkInterfaces()[normalized]?.find((entry) => entry.family === "IPv4");
  if (!address) {
    throw new Error(`WOL_INTERFACE does not resolve to an IPv4 address: ${normalized}`);
  }
  return normalized;
}

function readSecret(env: NodeJS.ProcessEnv): string {
  const configuredPath = env.GATEWAY_SHARED_SECRET_FILE?.trim();
  const filePath = configuredPath || DEFAULT_SECRET_FILE;

  try {
    const secret = fs.readFileSync(filePath, "utf8").trim();
    if (secret) {
      return secret;
    }
    if (configuredPath) {
      throw new Error(`GATEWAY_SHARED_SECRET_FILE is empty: ${configuredPath}`);
    }
  } catch (error) {
    if (configuredPath || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (configuredPath && (error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`GATEWAY_SHARED_SECRET_FILE does not exist: ${configuredPath}`);
      }
      throw error;
    }
  }

  return required(env.GATEWAY_SHARED_SECRET, "GATEWAY_SHARED_SECRET or GATEWAY_SHARED_SECRET_FILE");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const targetIp = ipAddress(required(env.TARGET_IP_ADDRESS, "TARGET_IP_ADDRESS"), "TARGET_IP_ADDRESS");
  const wolBroadcastAddress = ipv4Address(
    required(env.WOL_BROADCAST_ADDRESS, "WOL_BROADCAST_ADDRESS"),
    "WOL_BROADCAST_ADDRESS",
  );
  const readinessTimeoutMs = positiveInteger(
    env.READINESS_TIMEOUT_MS,
    "READINESS_TIMEOUT_MS",
    120_000,
  );
  const readinessPollIntervalMs = positiveInteger(
    env.READINESS_POLL_INTERVAL_MS,
    "READINESS_POLL_INTERVAL_MS",
    1_000,
  );
  const readinessProbeTimeoutMs = positiveInteger(
    env.READINESS_PROBE_TIMEOUT_MS,
    "READINESS_PROBE_TIMEOUT_MS",
    3_000,
  );

  if (readinessProbeTimeoutMs > readinessTimeoutMs) {
    throw new Error("READINESS_PROBE_TIMEOUT_MS cannot exceed READINESS_TIMEOUT_MS");
  }

  const bindHost = env.GATEWAY_BIND_HOST?.trim() || "0.0.0.0";
  ipAddress(bindHost, "GATEWAY_BIND_HOST");
  const wolInterface = validateWolInterface(env.WOL_INTERFACE);

  return {
    bindHost,
    port: port(env.GATEWAY_PORT, "GATEWAY_PORT", 4096),
    targetIp,
    targetPort: port(env.TARGET_OPENCODE_PORT, "TARGET_OPENCODE_PORT", 4096),
    gatewaySecret: readSecret(env),
    wolMacAddress: macAddress(required(env.TARGET_MAC_ADDRESS, "TARGET_MAC_ADDRESS")),
    wolBroadcastAddress,
    ...(wolInterface ? { wolInterface } : {}),
    readinessTimeoutMs,
    readinessPollIntervalMs,
    readinessProbeTimeoutMs,
  };
}
