import { loadConfig } from "./config.js";
import { GatewayHttpServer } from "./http-server.js";
import { logger } from "./logger.js";
import { ReadinessCoordinator } from "./readiness.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const readiness = new ReadinessCoordinator(config);
  const server = new GatewayHttpServer(config, readiness);

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down`);
    void server.stop().catch((error: unknown) => {
      logger.error("Failed to stop cleanly", error);
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  await server.start();
}

main().catch((error: unknown) => {
  logger.error("Startup failed", error);
  process.exitCode = 1;
});
