import { formatModelDisplayName } from "../pinned/format.js";
import { t } from "../i18n/index.js";
import { formatCompactToolInfo } from "./formatter.js";
import type { SubagentInfo } from "./aggregator.js";
import type { ToolInfo } from "./aggregator.js";

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
      title: toolTitle,
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

function formatSubagentActivity(subagent: SubagentInfo): string {
  if (subagent.status === "completed") {
    return `✅ ${t("subagent.completed")}`;
  }

  if (subagent.status === "error") {
    const message = subagent.terminalMessage?.trim() || t("subagent.failed");
    return `❌ ${message}`;
  }

  const toolStep = formatToolStep(subagent);
  if (toolStep) {
    return toolStep;
  }

  return `⚙️ ${t("subagent.working")}`;
}

async function formatSubagentCard(subagent: SubagentInfo): Promise<string> {
  const modelName = formatModelDisplayName(subagent.providerID, subagent.modelID);
  const lines = [
    `🧩 ${t("subagent.line.task", { task: subagent.description })}`,
    t("subagent.line.agent", { agent: subagent.agent }),
    t("pinned.line.model", { model: modelName }),
    "",
    formatSubagentActivity(subagent),
  ];

  return lines.join("\n");
}

export async function renderSubagentCards(subagents: SubagentInfo[]): Promise<string> {
  if (subagents.length === 0) {
    return "";
  }

  const parts = await Promise.all(subagents.map((subagent) => formatSubagentCard(subagent)));
  return parts.filter(Boolean).join("\n\n");
}
