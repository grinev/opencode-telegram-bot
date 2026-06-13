const SERVICE_CHILD_ENV_KEY = "OPENCODE_TELEGRAM_SERVICE_CHILD";
const SERVICE_STATE_PATH_ENV_KEY = "OPENCODE_TELEGRAM_SERVICE_STATE_PATH";

export function buildServiceChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  stateFilePath: string,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    [SERVICE_CHILD_ENV_KEY]: "1",
    [SERVICE_STATE_PATH_ENV_KEY]: stateFilePath,
  };
}

export function isServiceChildProcess(): boolean {
  return process.env[SERVICE_CHILD_ENV_KEY] === "1";
}

export function getServiceStateFilePathFromEnv(): string | null {
  const value = process.env[SERVICE_STATE_PATH_ENV_KEY];
  if (!value || value.trim().length === 0) {
    return null;
  }

  return value;
}
