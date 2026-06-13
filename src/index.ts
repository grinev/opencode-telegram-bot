import { resolveRuntimeMode, setRuntimeMode } from "./runtime/mode.js";

const EXIT_RUNTIME_ERROR = 1;
const EXIT_INVALID_ARGS = 2;

async function main(): Promise<void> {
  const modeResult = resolveRuntimeMode({
    defaultMode: "sources",
    argv: process.argv.slice(2),
  });

  if (modeResult.error) {
    process.stderr.write(`${modeResult.error}\n`);
    process.exit(EXIT_INVALID_ARGS);
    return;
  }

  setRuntimeMode(modeResult.mode);

  const { initializeLogger } = await import("./utils/logger.js");
  await initializeLogger();

  const { startBotApp } = await import("./app/bootstrap/start-bot-app.js");
  await startBotApp();
}

void main().catch((error: unknown) => {
  if (error instanceof Error) {
    process.stderr.write(`Failed to start bot: ${error.message}\n`);
  } else {
    process.stderr.write(`Failed to start bot: ${String(error)}\n`);
  }

  process.exit(EXIT_RUNTIME_ERROR);
});
