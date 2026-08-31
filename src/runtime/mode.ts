export type RuntimeMode = "sources" | "installed";

const RUNTIME_MODE_ENV_KEY = "OPENCODE_TELEGRAM_RUNTIME_MODE";

interface ResolveRuntimeModeOptions {
  defaultMode: RuntimeMode;
  argv?: string[] | undefined;
  explicitMode?: RuntimeMode | undefined;
}

export interface ResolveRuntimeModeResult {
  mode: RuntimeMode;
  error?: string;
}

function normalizeMode(value: string): RuntimeMode | null {
  if (value === "installed") {
    return "installed";
  }

  if (value === "sources") {
    return "sources";
  }

  return null;
}

function parseModeFromArgv(argv: string[]): RuntimeMode | null {
  let mode: RuntimeMode | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === "--mode") {
      const modeValue = argv[index + 1];
      if (!modeValue || modeValue.startsWith("-")) {
        return null;
      }

      mode = normalizeMode(modeValue);
      index += 1;
      continue;
    }

    if (token.startsWith("--mode=")) {
      mode = normalizeMode(token.slice("--mode=".length));
    }
  }

  return mode;
}

function hasInvalidModeSyntax(argv: string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === "--mode") {
      const modeValue = argv[index + 1];
      if (!modeValue || modeValue.startsWith("-")) {
        return true;
      }

      if (!normalizeMode(modeValue)) {
        return true;
      }

      index += 1;
      continue;
    }

    if (token.startsWith("--mode=")) {
      const modeValue = token.slice("--mode=".length);
      if (!normalizeMode(modeValue)) {
        return true;
      }
    }
  }

  return false;
}

export function resolveRuntimeMode(options: ResolveRuntimeModeOptions): ResolveRuntimeModeResult {
  if (options.explicitMode) {
    return { mode: options.explicitMode };
  }

  const argv = options.argv ?? [];
  if (hasInvalidModeSyntax(argv)) {
    return {
      mode: options.defaultMode,
      error: "Invalid value for --mode. Expected sources|installed",
    };
  }

  const modeFromArgv = parseModeFromArgv(argv);
  return { mode: modeFromArgv ?? options.defaultMode };
}

export function setRuntimeMode(mode: RuntimeMode): void {
  process.env[RUNTIME_MODE_ENV_KEY] = mode;
}

export function getRuntimeMode(): RuntimeMode {
  const rawMode = process.env[RUNTIME_MODE_ENV_KEY];
  const normalized = rawMode ? normalizeMode(rawMode) : null;
  return normalized ?? "sources";
}
