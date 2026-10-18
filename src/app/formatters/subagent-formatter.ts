import { t } from "../../i18n/index.js";
import {
  TOOL_ELAPSED_THRESHOLD_MS,
  appendDuration,
  bucketElapsedMs,
  formatDuration,
} from "./duration-formatter.js";
import { formatCompactToolInfo, formatRunningTaskLine } from "./summary-formatter.js";
import type { SubagentInfo } from "../managers/summary-aggregation-manager.js";
import type { ToolInfo } from "../managers/summary-aggregation-manager.js";

function formatModelDisplayName(subagent: SubagentInfo): string | null {
  if (!subagent.providerID || !subagent.modelID) {
    return null;
  }

  const name = `${subagent.providerID}/${subagent.modelID}`;
  if (subagent.variant) {
    return `${name} (${subagent.variant})`;
  }

  return name;
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

  // A nested subagent launch names its task, once its arguments are known.
  if (subagent.currentTool === "task") {
    const hasArguments = Object.keys(subagent.currentToolInput ?? {}).length > 0;
    return hasArguments ? formatRunningTaskLine(subagent.currentToolInput) : "";
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

function formatToolElapsed(startedAt: number | undefined, now: number): string | null {
  if (startedAt === undefined) {
    return null;
  }

  const elapsedMs = now - startedAt;
  if (elapsedMs < TOOL_ELAPSED_THRESHOLD_MS) {
    return null;
  }

  return formatDuration(bucketElapsedMs(elapsedMs));
}

function formatEndedLine(subagent: SubagentInfo, line: string): string {
  if (subagent.finishedAt === undefined) {
    return line;
  }

  // No threshold here: this is one line per subagent rather than a stream of
  // updates, matching how the assistant run footer always reports its time.
  return appendDuration(line, formatDuration(subagent.finishedAt - subagent.createdAt));
}

function formatSubagentActivity(subagent: SubagentInfo, now: number): string {
  if (subagent.status === "completed") {
    return formatEndedLine(subagent, `✅ ${t("subagent.completed")}`);
  }

  if (subagent.status === "interrupted") {
    return formatEndedLine(subagent, `⏹ ${t("subagent.interrupted")}`);
  }

  if (subagent.status === "error") {
    const message = subagent.terminalMessage?.trim() || t("subagent.failed");
    return `❌ ${message}`;
  }

  const toolStep = formatToolStep(subagent);
  if (toolStep) {
    const elapsed = formatToolElapsed(subagent.currentToolStartedAt, now);
    return elapsed ? appendDuration(toolStep, elapsed) : toolStep;
  }

  // Nothing newer on the line: a nested subagent it launched still runs.
  if (subagent.launchStartedAt !== undefined) {
    const launchLine = formatRunningTaskLine({ description: subagent.launchDescription });
    const elapsed = formatToolElapsed(subagent.launchStartedAt, now);
    return elapsed ? appendDuration(launchLine, elapsed) : launchLine;
  }

  return `⚙️ ${t("subagent.working")}`;
}

/** The Task, Agent and Model lines that are known so far. */
function formatHeaderLines(subagent: SubagentInfo): string[] {
  const modelName = formatModelDisplayName(subagent);
  return [
    subagent.description ? t("subagent.line.task", { task: subagent.description }) : null,
    subagent.agent ? t("subagent.line.agent", { agent: subagent.agent }) : null,
    modelName ? t("pinned.line.model", { model: modelName }) : null,
  ].filter((line): line is string => line !== null);
}

export async function renderSubagentCard(
  subagent: SubagentInfo,
  now: number = Date.now(),
): Promise<string> {
  const headerLines = formatHeaderLines(subagent);
  const isComplete = headerLines.length === 3;
  const hasEnded =
    subagent.status === "completed" ||
    subagent.status === "error" ||
    subagent.status === "interrupted";

  // Until Task, Agent and Model are all known a running card is one line, so it never
  // shows a placeholder or an empty label; an ended card keeps the lines it got.
  if (!isComplete && !hasEnded) {
    return subagent.description
      ? `🧩 ${t("subagent.starting", { task: subagent.description })}`
      : `🧩 ${t("subagent.starting_untitled")}`;
  }

  const activity = formatSubagentActivity(subagent, now);
  if (headerLines.length === 0) {
    return `🧩 ${activity}`;
  }

  return [`🧩 ${headerLines[0]}`, ...headerLines.slice(1), "", activity].join("\n");
}

export async function renderSubagentCards(
  subagents: SubagentInfo[],
  now: number = Date.now(),
): Promise<string> {
  if (subagents.length === 0) {
    return "";
  }

  const parts = await Promise.all(subagents.map((subagent) => renderSubagentCard(subagent, now)));
  return parts.filter(Boolean).join("\n\n");
}
