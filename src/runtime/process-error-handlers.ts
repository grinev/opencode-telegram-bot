import { logger } from "../utils/logger.js";

const PROCESS_EVENT = {
  UNHANDLED_REJECTION: "unhandledRejection",
  UNCAUGHT_EXCEPTION: "uncaughtException",
} as const;

let installed = false;

export function installProcessErrorHandlers(): void {
  if (installed) {
    return;
  }

  installed = true;

  process.on(PROCESS_EVENT.UNHANDLED_REJECTION, (reason: unknown) => {
    logger.error("[Runtime] Unhandled promise rejection", {
      reason,
    });
  });

  process.on(PROCESS_EVENT.UNCAUGHT_EXCEPTION, (error: Error) => {
    logger.error("[Runtime] Uncaught exception", {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  });
}
