// Container HEALTHCHECK entry. Kept free of config.ts (it throws without the bot's
// required env) and of the logger (a probe must not create log files).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { isContainerRuntime } from "./container.js";
import { BOT_HEALTH_PORT_ENV, resolveHealthPort } from "./health-port.js";
import { getRuntimePaths } from "./paths.js";

const PROBE_TIMEOUT_MS = 5000;

export interface HealthcheckOptions {
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
  dockerEnvExists?: () => boolean;
  timeoutMs?: number;
}

function readEnvFile(filePath: string): Record<string, string> {
  try {
    return dotenv.parse(readFileSync(filePath));
  } catch {
    return {};
  }
}

/** Resolves the port the way the bot does and probes liveness; returns the exit code. */
export async function runHealthcheck(options: HealthcheckOptions = {}): Promise<number> {
  const envFilePath = options.envFilePath ?? getRuntimePaths().envFilePath;
  // Same sources and precedence as config.ts: process env wins over the runtime .env.
  const env = { ...readEnvFile(envFilePath), ...(options.env ?? process.env) };
  const inContainer = isContainerRuntime({ ...options, env });
  const port = resolveHealthPort(env[BOT_HEALTH_PORT_ENV], inContainer);
  if (port === 0) {
    return 0;
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
    });
    return response.status === 200 ? 0 : 1;
  } catch {
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHealthcheck();
}
