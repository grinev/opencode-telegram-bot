import { attachManager } from "../managers/attach-manager.js";
import { foregroundSessionState } from "../managers/foreground-session-state-manager.js";
import { logger } from "../../utils/logger.js";
import { reconcileBusyStateNow } from "./busy-reconciliation-service.js";

export function isForegroundBusy(): boolean {
  return foregroundSessionState.isBusy() || attachManager.isBusy();
}

function getBusyDirectories(): string[] {
  const directories = new Set<string>();

  for (const session of foregroundSessionState.getBusySessions()) {
    directories.add(session.directory);
  }

  const attached = attachManager.getSnapshot();
  if (attached?.busy) {
    directories.add(attached.directory);
  }

  return [...directories];
}

export async function reconcileForegroundBusyState(): Promise<void> {
  if (!isForegroundBusy()) {
    return;
  }

  for (const directory of getBusyDirectories()) {
    try {
      await reconcileBusyStateNow(directory);
    } catch (error) {
      logger.warn("[BusyGuard] Failed to reconcile foreground busy state", error);
    }
  }
}
