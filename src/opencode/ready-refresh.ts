import { reconcileStoredModelSelection } from "../app/services/model-selection-service.js";
import { warmupSessionDirectoryCache } from "../app/services/session-cache-service.js";
import { logger } from "../utils/logger.js";
import type { AppContainer } from "../app/bootstrap/app-container.js";
import { checkOpencodeHealth } from "./server-health.js";

export type ReadyRefreshDeps = Pick<AppContainer, "opencodeReadyLifecycle">;

const MODEL_CATALOG_WAIT_TIMEOUT_MS = 3000;
const MODEL_CATALOG_POLL_INTERVAL_MS = 500;

let readyRefreshRegistered = false;

// A freshly started server answers health before it lists any model, so wait (bounded)
// for a non-empty catalog before the rest of the ready sequence reads it.
async function refreshModelCatalogUntilAvailable(reason: string): Promise<void> {
  const startedAt = Date.now();

  while (!(await reconcileStoredModelSelection({ forceCatalogRefresh: true }))) {
    if (Date.now() - startedAt >= MODEL_CATALOG_WAIT_TIMEOUT_MS) {
      logger.warn(
        `[OpenCodeReady] Model catalog still unavailable after ${MODEL_CATALOG_WAIT_TIMEOUT_MS}ms: reason=${reason}`,
      );
      return;
    }

    logger.debug(`[OpenCodeReady] Model catalog not available yet, retrying: reason=${reason}`);
    await new Promise((resolve) => setTimeout(resolve, MODEL_CATALOG_POLL_INTERVAL_MS));
  }
}

export async function isOpencodeServerHealthy(): Promise<boolean> {
  return (await checkOpencodeHealth()).healthy;
}

export async function refreshSessionCacheAfterOpencodeReady(reason: string): Promise<void> {
  try {
    await warmupSessionDirectoryCache();
    logger.debug(`[OpenCodeReady] Session cache refreshed: reason=${reason}`);
  } catch (error) {
    logger.warn(`[OpenCodeReady] Failed to refresh session cache: reason=${reason}`, error);
  }

  try {
    await refreshModelCatalogUntilAvailable(reason);
    logger.debug(`[OpenCodeReady] Model catalog refreshed: reason=${reason}`);
  } catch (error) {
    logger.warn(`[OpenCodeReady] Failed to refresh model catalog: reason=${reason}`, error);
  }
}

export async function refreshSessionCacheIfOpencodeReady(
  reason: string,
  deps: ReadyRefreshDeps,
): Promise<boolean> {
  if (!(await isOpencodeServerHealthy())) {
    deps.opencodeReadyLifecycle.notifyUnavailable(reason);
    logger.warn(
      `[OpenCodeReady] OpenCode server is not running; skipping session cache refresh: reason=${reason}`,
    );
    return false;
  }

  await refreshSessionCacheAfterOpencodeReady(reason);
  return true;
}

export function registerOpenCodeReadyRefreshHandler(deps: ReadyRefreshDeps): void {
  if (readyRefreshRegistered) {
    return;
  }

  readyRefreshRegistered = true;
  deps.opencodeReadyLifecycle.onReady((reason) => refreshSessionCacheAfterOpencodeReady(reason));
}

export async function notifyOpencodeReadyIfHealthy(
  reason: string,
  deps: ReadyRefreshDeps,
): Promise<boolean> {
  if (!(await isOpencodeServerHealthy())) {
    deps.opencodeReadyLifecycle.notifyUnavailable(reason);
    logger.warn(`[OpenCodeReady] OpenCode server is not running: reason=${reason}`);
    return false;
  }

  return deps.opencodeReadyLifecycle.notifyReady(reason);
}
