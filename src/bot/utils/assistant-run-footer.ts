import { getAgentDisplayName } from "../../agent/types.js";

interface AssistantRunFooterParams {
  agent: string;
  providerID: string;
  modelID: string;
  elapsedMs: number;
}

function formatDuration(elapsedMs: number): string {
  const safeElapsedMs = Math.max(0, Math.round(elapsedMs));
  const totalSeconds = Math.floor(safeElapsedMs / 1000);
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  
  return parts.join(" ");
}

export function formatAssistantRunFooter({
  agent,
  providerID,
  modelID,
  elapsedMs,
}: AssistantRunFooterParams): string {
  const agentDisplay = getAgentDisplayName(agent);
  return `${agentDisplay} · 🤖 ${providerID}/${modelID} · 🕒 ${formatDuration(elapsedMs)}`;
}
