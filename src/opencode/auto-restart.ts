import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { opencodeClient } from "./client.js";
import { opencodeReadyLifecycle } from "./ready-lifecycle.js";
import {
  resolveLocalOpencodeTarget,
  startLocalOpencodeServer,
  type LocalOpencodeTarget,
} from "./process.js";

const SERVER_READY_TIMEOUT_MS = 10000;
const SERVER_READY_POLL_INTERVAL_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isOpencodeServerHealthy(): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.global.health();
    return !error && data?.healthy === true;
  } catch {
    return false;
  }
}

async function waitForOpencodeServerReady(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isOpencodeServerHealthy()) {
      return true;
    }

    await sleep(SERVER_READY_POLL_INTERVAL_MS);
  }

  return false;
}

export class OpencodeAutoRestartService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private localTarget: LocalOpencodeTarget | null = null;
  private started = false;
  private checkInProgress = false;
  private serverWasHealthy = false;

  async start(): Promise<boolean> {
    if (this.started || !config.opencode.autoRestartEnabled) {
      return false;
    }

    const localTarget = resolveLocalOpencodeTarget(config.opencode.apiUrl);
    if (!localTarget) {
      logger.warn(
        `[OpenCodeAutoRestart] Disabled because OPENCODE_API_URL is not local: ${config.opencode.apiUrl}`,
      );
      return false;
    }

    this.started = true;
    this.localTarget = localTarget;

    logger.info(
      `[OpenCodeAutoRestart] Enabled: port=${localTarget.port}, intervalSec=${config.opencode.monitorIntervalSec}`,
    );

    await this.checkAndRestart("startup");

    this.timer = setInterval(() => {
      void this.checkAndRestart("interval");
    }, config.opencode.monitorIntervalSec * 1000);
    this.timer.unref?.();

    return true;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.started = false;
    this.localTarget = null;
    this.serverWasHealthy = false;
  }

  private async checkAndRestart(reason: "startup" | "interval"): Promise<void> {
    if (this.checkInProgress || !this.localTarget) {
      return;
    }

    this.checkInProgress = true;

    try {
      if (await isOpencodeServerHealthy()) {
        logger.debug(`[OpenCodeAutoRestart] Health-check succeeded: reason=${reason}`);
        if (!this.serverWasHealthy) {
          this.serverWasHealthy = true;
          await opencodeReadyLifecycle.notifyReady(`auto_restart_${reason}`);
        }
        return;
      }

      this.serverWasHealthy = false;
      opencodeReadyLifecycle.notifyUnavailable(`auto_restart_${reason}`);

      logger.warn(
        `[OpenCodeAutoRestart] OpenCode server is unavailable, starting local server: reason=${reason}, port=${this.localTarget.port}`,
      );

      const childProcess = startLocalOpencodeServer(this.localTarget);
      childProcess.once("error", (error) => {
        logger.error("[OpenCodeAutoRestart] OpenCode server process failed to start", error);
      });

      const pid = childProcess.pid;
      childProcess.unref();

      const ready = await waitForOpencodeServerReady(SERVER_READY_TIMEOUT_MS);
      if (!ready) {
        logger.warn(
          `[OpenCodeAutoRestart] OpenCode server was started but did not become ready: pid=${pid ?? "unknown"}, port=${this.localTarget.port}`,
        );
        return;
      }

      logger.info(
        `[OpenCodeAutoRestart] OpenCode server recovered: pid=${pid ?? "unknown"}, port=${this.localTarget.port}`,
      );
      this.serverWasHealthy = true;
      await opencodeReadyLifecycle.notifyReady(`auto_restart_${reason}`);
    } catch (error) {
      logger.error("[OpenCodeAutoRestart] Failed to check or restart OpenCode server", error);
    } finally {
      this.checkInProgress = false;
    }
  }
}

export const opencodeAutoRestartService = new OpencodeAutoRestartService();
