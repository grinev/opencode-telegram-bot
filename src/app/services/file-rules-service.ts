import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRuntimePaths } from "../../runtime/paths.js";
import { logger } from "../../utils/logger.js";

export type FileActionType = "save" | "open" | "copy_text" | "exec";

export interface FileAction {
  id: string;
  label: string;
  type: FileActionType;
  path?: string;
  command?: string;
}

export interface FileRule {
  mime?: string;
  extensions?: string[];
  actions: FileAction[];
}

export interface FileRulesConfig {
  rules: FileRule[];
  default: { actions: FileAction[] };
  settings?: {
    tempPath?: string;
    maxFileSizeMb?: number;
  };
}

let cachedRules: FileRulesConfig | null = null;

export function loadFileRules(): FileRulesConfig {
  if (cachedRules) {
    return cachedRules;
  }

  const runtimePaths = getRuntimePaths();
  const rulesPath =
    process.env.UNSUPPORTED_FILE_RULES_PATH ||
    path.join(runtimePaths.localCommandsDirPath, "file-rules.json");

  try {
    const content = fs.readFileSync(rulesPath, "utf-8");
    const parsed = JSON.parse(content) as FileRulesConfig;

    if (!parsed.rules || !Array.isArray(parsed.rules)) {
      throw new Error("Invalid file-rules.json: missing 'rules' array");
    }
    if (!parsed.default || !parsed.default.actions || !Array.isArray(parsed.default.actions)) {
      throw new Error("Invalid file-rules.json: missing 'default.actions' array");
    }

    cachedRules = parsed;
    logger.info(`[FileRules] Loaded ${parsed.rules.length} rules from ${rulesPath}`);
    return cachedRules;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      logger.warn(`[FileRules] No file-rules.json found at ${rulesPath}, using defaults`);
      cachedRules = {
        rules: [],
        default: {
          actions: [
            { id: "save_default", label: "💾 Guardar en carpeta por defecto", type: "save", path: path.join(os.homedir(), "Downloads", "Telegram") },
            { id: "open", label: "🖥 Abrir en SO", type: "open" },
            { id: "copy_text", label: "📋 Copiar como texto", type: "copy_text" },
          ],
        },
        settings: {
          tempPath: path.join(os.tmpdir(), "opencode-telegram"),
          maxFileSizeMb: 50,
        },
      };
      return cachedRules;
    }
    logger.error("[FileRules] Failed to load file-rules.json:", err);
    cachedRules = {
      rules: [],
      default: {
        actions: [
          { id: "save_default", label: "💾 Guardar en carpeta por defecto", type: "save", path: path.join(os.homedir(), "Downloads", "Telegram") },
          { id: "open", label: "🖥 Abrir en SO", type: "open" },
          { id: "copy_text", label: "📋 Copiar como texto", type: "copy_text" },
        ],
      },
      settings: {
        tempPath: path.join(os.tmpdir(), "opencode-telegram"),
        maxFileSizeMb: 50,
      },
    };
    return cachedRules;
  }
}

/**
 * Actions declared for this exact file, or null when no rule matches.
 * Use this where a default menu would be wrong (voice notes have their own
 * "STT not configured" answer).
 */
export function findRuleActions(mimeType: string, filename: string): FileAction[] | null {
  const config = loadFileRules();

  for (const rule of config.rules) {
    if (rule.mime && rule.mime === mimeType) {
      return rule.actions;
    }
  }

  const ext = path.extname(filename).toLowerCase();
  for (const rule of config.rules) {
    if (rule.extensions && rule.extensions.includes(ext)) {
      return rule.actions;
    }
  }

  return null;
}

/** Rule actions, falling back to the configured defaults (documents). */
export function findFileActions(mimeType: string, filename: string): FileAction[] {
  return findRuleActions(mimeType, filename) ?? loadFileRules().default.actions;
}

export function getTempPath(): string {
  const config = loadFileRules();
  return config.settings?.tempPath || path.join(os.tmpdir(), "opencode-telegram");
}

export function getMaxFileSizeMb(): number {
  const config = loadFileRules();
  return config.settings?.maxFileSizeMb || 50;
}

export function clearFileRulesCache(): void {
  cachedRules = null;
}
