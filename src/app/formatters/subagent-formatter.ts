import { t } from "../../i18n/index.js";
import {
  TOOL_ELAPSED_THRESHOLD_MS,
  appendDuration,
  bucketElapsedMs,
  formatDuration,
} from "./duration-formatter.js";
import { formatCompactToolInfo } from "./summary-formatter.js";
import type { SubagentInfo } from "../managers/summary-aggregation-manager.js";
import type { ToolInfo } from "../managers/summary-aggregation-manager.js";

function formatModelDisplayName(providerID?: string | null, modelID?: string | null): string {
  if (providerID && modelID) {
    return `${providerID}/${modelID}`;
  }

  return t("pinned.unknown");
}

function shouldPreferInputDetails(tool: string, input?: { [key: string]: unknown }): boolean {
  if (!input) {
    return false;
  }

  switch (tool) {
    case "read":
    case "edit":
    case "write":
    case "apply_patch":
      return typeof input.path === "string" || typeof input.filePath === "string";
    case "bash":
      return typeof input.command === "string";
    case "grep":
    case "glob":
      return typeof input.pattern === "string";
  }

  return ["query", "url", "name", "prompt", "text"].some(
    (field) => typeof input[field] === "string",
  );
}

function formatToolStep(subagent: SubagentInfo): string {
  if (!subagent.currentTool) {
    return "";
  }

  const toolTitle = shouldPreferInputDetails(subagent.currentTool, subagent.currentToolInput)
    ? undefined
    : subagent.currentToolTitle;
  const toolInfo: ToolInfo = {
    sessionId: subagent.sessionId ?? subagent.parentSessionId,
    messageId: subagent.cardId,
    callId: subagent.cardId,
    tool: subagent.currentTool,
    state: {
      status: "running",
      input: subagent.currentToolInput ?? {},
      ...(toolTitle !== undefined ? { title: toolTitle } : {}),
      metadata: {},
      time: { start: subagent.updatedAt },
    },
    input: subagent.currentToolInput,
    title: toolTitle,
    metadata: {},
    hasFileAttachment: false,
  };

  const formatted = formatCompactToolInfo(toolInfo, 128, "").trim();
  const firstSpaceIndex = formatted.indexOf(" ");
  if (firstSpaceIndex >= 0 && formatted.slice(firstSpaceIndex + 1) === subagent.currentTool) {
    return "";
  }

  return formatted;
}

function formatToolElapsed(subagent: SubagentInfo, now: number): string | null {
  if (subagent.currentToolStartedAt === undefined) {
    return null;
  }

  const elapsedMs = now - subagent.currentToolStartedAt;
  if (elapsedMs < TOOL_ELAPSED_THRESHOLD_MS) {
    return null;
  }

  return formatDuration(bucketElapsedMs(elapsedMs));
}

function formatSubagentActivity(subagent: SubagentInfo, now: number): string {
  if (subagent.status === "completed") {
    const completed = `✅ ${t("subagent.completed")}`;
    if (subagent.finishedAt === undefined) {
      return completed;
    }

    // No threshold here: this is one line per subagent rather than a stream of
    // updates, matching how the assistant run footer always reports its time.
    return appendDuration(
      completed,
      formatDuration(subagent.finishedAt - subagent.createdAt),
    );
  }

  if (subagent.status === "error") {
    const message = subagent.terminalMessage?.trim() || t("subagent.failed");
    return `❌ ${message}`;
  }

  const toolStep = formatToolStep(subagent);
  if (toolStep) {
    const elapsed = formatToolElapsed(subagent, now);
    return elapsed ? appendDuration(toolStep, elapsed) : toolStep;
  }

  return `⚙️ ${t("subagent.working")}`;
}

async function formatSubagentCard(subagent: SubagentInfo, now: number): Promise<string> {
  const modelName = formatModelDisplayName(subagent.providerID, subagent.modelID);
  const lines = [
    `🧩 ${t("subagent.line.task", { task: subagent.description })}`,
    t("subagent.line.agent", { agent: subagent.agent }),
    t("pinned.line.model", { model: modelName }),
    "",
    formatSubagentActivity(subagent, now),
  ];

  return lines.join("\n");
}

export async function renderSubagentCards(
  subagents: SubagentInfo[],
  now: number = Date.now(),
): Promise<string> {
  if (subagents.length === 0) {
    return "";
  }

  const parts = await Promise.all(subagents.map((subagent) => formatSubagentCard(subagent, now)));
  return parts.filter(Boolean).join("\n\n");
}
