import path from "bun:path";
import { getRuntimePaths, type RuntimePaths } from "./paths.js";
import {
  getLocale,
  getLocaleOptions,
  resolveSupportedLocale,
  setRuntimeLocale,
  t,
  type Locale,
} from "../i18n/index.js";

const DEFAULT_API_URL = "http://localhost:4096";
const DEFAULT_SERVER_USERNAME = "opencode";
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
  locale: Locale;
  token: string;
  allowedUserId: string;
  apiUrl?: string | undefined;
  serverUsername: string;
  serverPassword?: string | undefined;
}

export interface WizardEnvValues {
  BOT_LOCALE: Locale;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_USER_ID: string;
  OPENCODE_API_URL?: string | undefined;
  OPENCODE_SERVER_USERNAME: string;
  OPENCODE_SERVER_PASSWORD?: string | undefined;
  OPENCODE_MODEL_PROVIDER: string;
  OPENCODE_MODEL_ID: string;
}

interface ParsedEnvAssignmentLine {
  key: string;
  rawValue: string;
  line: string;
  isCommented: boolean;
}

const WIZARD_ENV_KEYS: ReadonlyArray<keyof WizardEnvValues> = [
  "BOT_LOCALE",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_USER_ID",
  "OPENCODE_API_URL",
  "OPENCODE_SERVER_USERNAME",
  "OPENCODE_SERVER_PASSWORD",
  "OPENCODE_MODEL_PROVIDER",
  "OPENCODE_MODEL_ID",
];

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

function parseEnvAssignmentLine(line: string): ParsedEnvAssignmentLine | null {
  const match = /^(\s*#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  const key = match[2];
  const rawValue = match[3];
  if (key === undefined || rawValue === undefined) {
    return null;
  }
  return {
    key,
    rawValue,
    line,
    isCommented: typeof match[1] === "string",
  };
}

function buildTemplateKeySet(templateContent: string): Set<string> {
  const keys = new Set<string>();

  for (const line of normalizeEnvLineEndings(templateContent)) {
    const parsedLine = parseEnvAssignmentLine(line);
    if (parsedLine !== null) {
      keys.add(parsedLine.key);
    }
  }

  return keys;
}

function collectActiveEnvAssignments(content: string): Map<string, ParsedEnvAssignmentLine> {
  const assignments = new Map<string, ParsedEnvAssignmentLine>();

  for (const line of normalizeEnvLineEndings(content)) {
    const parsedLine = parseEnvAssignmentLine(line);
    if (parsedLine === null || parsedLine.isCommented) {
      continue;
    }

    assignments.set(parsedLine.key, parsedLine);
  }

  return assignments;
}

function collectCustomEnvAssignments(existingContent: string, templateKeys: Set<string>): string[] {
  const customAssignments: ParsedEnvAssignmentLine[] = [];
  const seenKeys = new Set<string>();

  const lines = normalizeEnvLineEndings(existingContent);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const parsedLine = parseEnvAssignmentLine(line);
    if (parsedLine === null || parsedLine.isCommented || templateKeys.has(parsedLine.key)) {
      continue;
    }

    if (seenKeys.has(parsedLine.key)) {
      continue;
    }

    seenKeys.add(parsedLine.key);
    customAssignments.push(parsedLine);
  }

  return customAssignments.reverse().map((assignment) => assignment.line);
}

function renderEnvAssignment(key: string, rawValue: string): string {
  return `${key}=${rawValue}`;
}

function finalizeEnvContent(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function buildFlatEnvFileContent(existingContent: string, values: WizardEnvValues): string {
  let lines = normalizeEnvLineEndings(existingContent);

  const orderedUpdates: Array<[keyof WizardEnvValues, string | undefined]> = [
    ["BOT_LOCALE", values.BOT_LOCALE],
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

export function buildEnvFileContent(
  existingContent: string,
  values: WizardEnvValues,
  envExampleContent?: string | null,
): string {
  if (!envExampleContent) {
    return buildFlatEnvFileContent(existingContent, values);
  }

  const templateLines = normalizeEnvLineEndings(envExampleContent);
  if (templateLines.length === 0) {
    return buildFlatEnvFileContent(existingContent, values);
  }

  const templateKeys = buildTemplateKeySet(envExampleContent);
  const existingAssignments = collectActiveEnvAssignments(existingContent);
  const wizardOverrides = new Map<string, string | undefined>(
    WIZARD_ENV_KEYS.map((key) => [key, values[key]]),
  );

  const renderedLines = templateLines.map((line) => {
    const parsedLine = parseEnvAssignmentLine(line);
    if (parsedLine === null) {
      return line;
    }

    if (wizardOverrides.has(parsedLine.key)) {
      const overrideValue = wizardOverrides.get(parsedLine.key);
      if (overrideValue && overrideValue.trim().length > 0) {
        return renderEnvAssignment(parsedLine.key, overrideValue);
      }

      return line;
    }

    const existingAssignment = existingAssignments.get(parsedLine.key);
    if (existingAssignment !== undefined) {
      return renderEnvAssignment(parsedLine.key, existingAssignment.rawValue);
    }

    return line;
  });

  const customAssignments = collectCustomEnvAssignments(existingContent, templateKeys);
  if (customAssignments.length > 0) {
    if (renderedLines.length > 0 && renderedLines[renderedLines.length - 1] !== "") {
      renderedLines.push("");
    }

    renderedLines.push(...customAssignments);
  }

  return finalizeEnvContent(renderedLines);
}

async function mkdirRecursive(dirPath: string): Promise<void> {
  const proc = Bun.spawn(["mkdir", "-p", dirPath], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

async function atomicRename(from: string, to: string): Promise<void> {
  const proc = Bun.spawn(["mv", from, to], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

async function readEnvFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(filePath).text();
  } catch (error) {
    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "ENOENT") {
        return null;
      }
    }
    throw error;
  }
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  await mkdirRecursive(path.dirname(filePath));

  const tempFilePath = `${filePath}.${process.pid}.tmp`;
  await Bun.write(tempFilePath, content);
  await atomicRename(tempFilePath, filePath);
}

async function ensureSettingsFile(settingsFilePath: string): Promise<void> {
  const exists = await Bun.file(settingsFilePath).exists();
  if (exists) {
    return;
  }

  await mkdirRecursive(path.dirname(settingsFilePath));
  await Bun.write(settingsFilePath, "{}\n");
}

function getEnvExamplePath(): string {
  const currentFilePath = Bun.fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFilePath), "..", "..", ".env.example");
}

async function loadEnvExampleContent(): Promise<string | null> {
  try {
    return await Bun.file(getEnvExamplePath()).text();
  } catch {
    return null;
  }
}

function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Skip lines without '='
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      value.length >= 2 &&
      ((value[0] === '"' && value[value.length - 1] === '"') ||
        (value[0] === "'" && value[value.length - 1] === "'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

function loadModelDefaultsFromEnvExample(envExampleContent: string | null): ModelDefaults {
  const fallbackDefaults: ModelDefaults = {
    provider: FALLBACK_MODEL_PROVIDER,
    modelId: FALLBACK_MODEL_ID,
  };

  try {
    if (!envExampleContent) {
      return fallbackDefaults;
    }

    const parsed = parseEnvContent(envExampleContent);

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
  process.stdout.write(question);
  for await (const line of console) {
    return line.toString().trim();
  }
  return "";
}

async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    const text = decoder.decode(chunk, { stream: true });
    for (const char of text) {
      if (char === "\n" || char === "\r") {
        process.stdout.write("\n");
        return buffer.trim();
      }
      if (char === "\u007f" || char === "\b") {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          process.stdout.write("\b \b");
        }
        continue;
      }
      if (char === "\u0003") {
        process.stdout.write("\n");
        throw new Error("interrupted");
      }
      buffer += char;
      process.stdout.write("*");
    }
  }

  process.stdout.write("\n");
  return buffer.trim();
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

async function askLocale(): Promise<Locale> {
  const localeOptions = getLocaleOptions();
  const defaultLocale = getLocale();
  const defaultLocaleOption =
    localeOptions.find((localeOption) => localeOption.code === defaultLocale) ?? localeOptions[0];
  if (!defaultLocaleOption) {
    return defaultLocale;
  }
  const optionsText = localeOptions
    .map((localeOption, index) => `${index + 1} - ${localeOption.label} (${localeOption.code})`)
    .join("\n");

  const prompt = t("runtime.wizard.ask_language", {
    options: optionsText,
    defaultLocale: `${defaultLocaleOption.label} (${defaultLocaleOption.code})`,
  });

  for (;;) {
    const answer = await askVisible(prompt);

    if (!answer) {
      return defaultLocaleOption.code;
    }

    if (/^\d+$/.test(answer)) {
      const index = Number.parseInt(answer, 10) - 1;
      if (index >= 0 && index < localeOptions.length) {
        const selectedLocale = localeOptions[index];
        if (selectedLocale) {
          return selectedLocale.code;
        }
      }
    }

    const localeByCode = resolveSupportedLocale(answer);
    if (localeByCode) {
      return localeByCode;
    }

    process.stdout.write(t("runtime.wizard.language_invalid"));
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

async function askServerUsername(): Promise<string> {
  const prompt = t("runtime.wizard.ask_server_username", {
    defaultUsername: DEFAULT_SERVER_USERNAME,
  });

  const username = await askVisible(prompt);
  if (!username) {
    return DEFAULT_SERVER_USERNAME;
  }

  return username;
}

async function askServerPassword(): Promise<string | undefined> {
  const password = await askHidden(t("runtime.wizard.ask_server_password"));
  if (!password) {
    return undefined;
  }

  return password;
}

async function collectWizardValues(): Promise<WizardCollectedValues> {
  const locale = await askLocale();
  setRuntimeLocale(locale);
  const selectedLocaleOption =
    getLocaleOptions().find((localeOption) => localeOption.code === locale) ?? null;

  process.stdout.write("\n");
  process.stdout.write(
    t("runtime.wizard.language_selected", {
      language:
        selectedLocaleOption !== null
          ? `${selectedLocaleOption.label} (${selectedLocaleOption.code})`
          : locale,
    }),
  );
  process.stdout.write("\n");
  process.stdout.write(t("runtime.wizard.start"));
  process.stdout.write("\n");

  const token = await askToken();
  const allowedUserId = await askAllowedUserId();
  const apiUrl = await askApiUrl();
  const serverUsername = await askServerUsername();
  const serverPassword = await askServerPassword();

  process.stdout.write("\n");

  return {
    locale,
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
  const effectiveValues: Record<string, string> = content === null ? {} : parseEnvContent(content);

  for (const key of WIZARD_ENV_KEYS) {
    const processValue = process.env[key];
    if (processValue !== undefined) {
      effectiveValues[key] = processValue;
    }
  }

  return validateRuntimeEnvValues(effectiveValues);
}

async function runWizardAndPersist(runtimePaths: RuntimePaths): Promise<void> {
  ensureInteractiveTty();

  const [existingContent, envExampleContent, wizardValues] = await Promise.all([
    readEnvFileIfExists(runtimePaths.envFilePath),
    loadEnvExampleContent(),
    collectWizardValues(),
  ]);

  const modelDefaults = loadModelDefaultsFromEnvExample(envExampleContent);
  const existingParsed = existingContent ? parseEnvContent(existingContent) : {};
  const provider = existingParsed.OPENCODE_MODEL_PROVIDER || modelDefaults.provider;
  const modelId = existingParsed.OPENCODE_MODEL_ID || modelDefaults.modelId;

  const envValues: WizardEnvValues = {
    BOT_LOCALE: wizardValues.locale,
    TELEGRAM_BOT_TOKEN: wizardValues.token,
    TELEGRAM_ALLOWED_USER_ID: wizardValues.allowedUserId,
    OPENCODE_API_URL: wizardValues.apiUrl,
    OPENCODE_SERVER_USERNAME: wizardValues.serverUsername,
    OPENCODE_SERVER_PASSWORD: wizardValues.serverPassword,
    OPENCODE_MODEL_PROVIDER: provider,
    OPENCODE_MODEL_ID: modelId,
  };

  const envContent = buildEnvFileContent(existingContent ?? "", envValues, envExampleContent);
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
