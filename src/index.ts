import { resolveRuntimeMode, setRuntimeMode } from "./runtime/mode.js";
import { installProcessErrorHandlers } from "./runtime/process-error-handlers.js";

const EXIT_RUNTIME_ERROR = 1;
const EXIT_INVALID_ARGS = 2;

async function main(): Promise<void> {
  installProcessErrorHandlers();

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

  const { startBotApp } = await import("./app/start-bot-app.js");
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
