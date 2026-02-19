import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getRuntimePaths, type RuntimePaths } from "./paths.js";
import { t } from "../i18n/index.js";

const DEFAULT_API_URL = "http://localhost:4096";
const FALLBACK_MODEL_PROVIDER = "opencode";
const FALLBACK_MODEL_ID = "big-pickle";

interface ModelDefaults {
  provider: string;
  modelId: string;
}

interface EnvValidationResult {
  isValid: boolean;
  reason?: string;
}

interface WizardCollectedValues {
  token: string;
  allowedUserId: string;
  apiUrl?: string;
  serverUsername?: string;
  serverPassword?: string;
}

export interface WizardEnvValues {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_USER_ID: string;
  OPENCODE_API_URL?: string;
  OPENCODE_SERVER_USERNAME?: string;
  OPENCODE_SERVER_PASSWORD?: string;
  OPENCODE_MODEL_PROVIDER: string;
  OPENCODE_MODEL_ID: string;
}

function isPositiveInteger(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateRuntimeEnvValues(values: Record<string, string>): EnvValidationResult {
  if (!values.TELEGRAM_BOT_TOKEN || values.TELEGRAM_BOT_TOKEN.trim().length === 0) {
    return { isValid: false, reason: "Missing TELEGRAM_BOT_TOKEN" };
  }

  if (!isPositiveInteger(values.TELEGRAM_ALLOWED_USER_ID || "")) {
    return { isValid: false, reason: "Invalid TELEGRAM_ALLOWED_USER_ID" };
  }

  if (!values.OPENCODE_MODEL_PROVIDER || values.OPENCODE_MODEL_PROVIDER.trim().length === 0) {
    return { isValid: false, reason: "Missing OPENCODE_MODEL_PROVIDER" };
  }

  if (!values.OPENCODE_MODEL_ID || values.OPENCODE_MODEL_ID.trim().length === 0) {
    return { isValid: false, reason: "Missing OPENCODE_MODEL_ID" };
  }

  const apiUrl = values.OPENCODE_API_URL?.trim();
  if (apiUrl && !isValidHttpUrl(apiUrl)) {
    return { isValid: false, reason: "Invalid OPENCODE_API_URL" };
  }

  return { isValid: true };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeEnvLineEndings(content: string): string[] {
  const lines = content.split(/\r?\n/).map((line) => line.replace(/\r$/, ""));

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function removeEnvKey(lines: string[], key: string): string[] {
  const regex = new RegExp(`^\\s*(?:export\\s+)?${escapeRegex(key)}\\s*=`);
  return lines.filter((line) => !regex.test(line));
}

function finalizeEnvContent(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

export function buildEnvFileContent(existingContent: string, values: WizardEnvValues): string {
  let lines = normalizeEnvLineEndings(existingContent);

  const orderedUpdates: Array<[keyof WizardEnvValues, string | undefined]> = [
    ["TELEGRAM_BOT_TOKEN", values.TELEGRAM_BOT_TOKEN],
    ["TELEGRAM_ALLOWED_USER_ID", values.TELEGRAM_ALLOWED_USER_ID],
    ["OPENCODE_API_URL", values.OPENCODE_API_URL],
    ["OPENCODE_SERVER_USERNAME", values.OPENCODE_SERVER_USERNAME],
    ["OPENCODE_SERVER_PASSWORD", values.OPENCODE_SERVER_PASSWORD],
    ["OPENCODE_MODEL_PROVIDER", values.OPENCODE_MODEL_PROVIDER],
    ["OPENCODE_MODEL_ID", values.OPENCODE_MODEL_ID],
  ];

  for (const [key, value] of orderedUpdates) {
    lines = removeEnvKey(lines, key);

    if (value && value.trim().length > 0) {
      lines.push(`${key}=${value}`);
    }
  }

  return finalizeEnvContent(lines);
}

async function readEnvFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempFilePath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempFilePath, content, "utf-8");
  await fs.rename(tempFilePath, filePath);
}

async function ensureSettingsFile(settingsFilePath: string): Promise<void> {
  try {
    await fs.access(settingsFilePath);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
  await fs.writeFile(settingsFilePath, "{}\n", "utf-8");
}

function getEnvExamplePath(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..", ".env.example");
}

async function loadModelDefaultsFromEnvExample(): Promise<ModelDefaults> {
  const fallbackDefaults: ModelDefaults = {
    provider: FALLBACK_MODEL_PROVIDER,
    modelId: FALLBACK_MODEL_ID,
  };

  try {
    const content = await fs.readFile(getEnvExamplePath(), "utf-8");
    const parsed = dotenv.parse(content);

    const provider = parsed.OPENCODE_MODEL_PROVIDER?.trim();
    const modelId = parsed.OPENCODE_MODEL_ID?.trim();

    if (!provider || !modelId) {
      return fallbackDefaults;
    }

    return {
      provider,
      modelId,
    };
  } catch {
    return fallbackDefaults;
  }
}

async function askVisible(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const maskedRl = rl as readline.Interface & {
      stdoutMuted?: boolean;
      _writeToOutput?: (value: string) => void;
    };

    maskedRl._writeToOutput = (value: string): void => {
      if (maskedRl.stdoutMuted) {
        if (value.includes("\n") || value.includes("\r")) {
          process.stdout.write(value);
          return;
        }

        if (value.length > 0) {
          process.stdout.write("*");
        }
        return;
      }

      process.stdout.write(value);
    };

    maskedRl.stdoutMuted = false;

    rl.question(question, (answer) => {
      maskedRl.stdoutMuted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });

    maskedRl.stdoutMuted = true;
  });
}

async function askToken(): Promise<string> {
  for (;;) {
    const token = await askHidden(t("runtime.wizard.ask_token"));

    if (!token) {
      process.stdout.write(t("runtime.wizard.token_required"));
      continue;
    }

    if (!token.includes(":")) {
      process.stdout.write(t("runtime.wizard.token_invalid"));
      continue;
    }

    return token;
  }
}

async function askAllowedUserId(): Promise<string> {
  for (;;) {
    const allowedUserId = await askVisible(t("runtime.wizard.ask_user_id"));

    if (!isPositiveInteger(allowedUserId)) {
      process.stdout.write(t("runtime.wizard.user_id_invalid"));
      continue;
    }

    return allowedUserId;
  }
}

async function askApiUrl(): Promise<string | undefined> {
  const prompt = t("runtime.wizard.ask_api_url", { defaultUrl: DEFAULT_API_URL });

  for (;;) {
    const apiUrl = await askVisible(prompt);

    if (!apiUrl) {
      return undefined;
    }

    if (!isValidHttpUrl(apiUrl)) {
      process.stdout.write(t("runtime.wizard.api_url_invalid"));
      continue;
    }

    return apiUrl;
  }
}

async function askServerUsername(): Promise<string | undefined> {
  const prompt = t("runtime.wizard.ask_server_username");
  const username = await askVisible(prompt);

  if (!username) {
    return undefined;
  }

  return username;
}

async function askServerPassword(): Promise<string | undefined> {
  const prompt = t("runtime.wizard.ask_server_password");
  const password = await askHidden(prompt);

  if (!password) {
    return undefined;
  }

  return password;
}

async function collectWizardValues(): Promise<WizardCollectedValues> {
  process.stdout.write(t("runtime.wizard.start"));
  process.stdout.write("\n");

  const token = await askToken();
  const allowedUserId = await askAllowedUserId();
  const apiUrl = await askApiUrl();

  process.stdout.write("\n");
  process.stdout.write(t("runtime.wizard.server_auth_header"));
  process.stdout.write("\n");

  const serverUsername = await askServerUsername();
  const serverPassword = await askServerPassword();

  process.stdout.write("\n");

  return {
    token,
    allowedUserId,
    apiUrl,
    serverUsername,
    serverPassword,
  };
}

function ensureInteractiveTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(t("runtime.wizard.tty_required"));
  }
}

async function validateExistingEnv(envFilePath: string): Promise<EnvValidationResult> {
  const content = await readEnvFileIfExists(envFilePath);

  if (content === null) {
    return { isValid: false, reason: "Missing .env" };
  }

  const parsed = dotenv.parse(content);
  return validateRuntimeEnvValues(parsed);
}

async function runWizardAndPersist(runtimePaths: RuntimePaths): Promise<void> {
  ensureInteractiveTty();

  const [existingContent, modelDefaults, wizardValues] = await Promise.all([
    readEnvFileIfExists(runtimePaths.envFilePath),
    loadModelDefaultsFromEnvExample(),
    collectWizardValues(),
  ]);

  const existingParsed = existingContent ? dotenv.parse(existingContent) : {};
  const provider = existingParsed.OPENCODE_MODEL_PROVIDER || modelDefaults.provider;
  const modelId = existingParsed.OPENCODE_MODEL_ID || modelDefaults.modelId;

  const envValues: WizardEnvValues = {
    TELEGRAM_BOT_TOKEN: wizardValues.token,
    TELEGRAM_ALLOWED_USER_ID: wizardValues.allowedUserId,
    OPENCODE_API_URL: wizardValues.apiUrl,
    OPENCODE_SERVER_USERNAME: wizardValues.serverUsername,
    OPENCODE_SERVER_PASSWORD: wizardValues.serverPassword,
    OPENCODE_MODEL_PROVIDER: provider,
    OPENCODE_MODEL_ID: modelId,
  };

  const envContent = buildEnvFileContent(existingContent ?? "", envValues);
  await writeFileAtomically(runtimePaths.envFilePath, envContent);
  await ensureSettingsFile(runtimePaths.settingsFilePath);

  process.stdout.write(
    t("runtime.wizard.saved", {
      envPath: runtimePaths.envFilePath,
      settingsPath: runtimePaths.settingsFilePath,
    }),
  );
}

export async function ensureRuntimeConfigForStart(): Promise<void> {
  const runtimePaths = getRuntimePaths();

  if (runtimePaths.mode !== "installed") {
    return;
  }

  const validationResult = await validateExistingEnv(runtimePaths.envFilePath);
  if (validationResult.isValid) {
    await ensureSettingsFile(runtimePaths.settingsFilePath);
    return;
  }

  process.stdout.write(t("runtime.wizard.not_configured_starting"));
  await runWizardAndPersist(runtimePaths);
}

export async function runConfigWizardCommand(): Promise<void> {
  const runtimePaths = getRuntimePaths();
  await runWizardAndPersist(runtimePaths);
}
