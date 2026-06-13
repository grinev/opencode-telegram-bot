/**
 * Agent information from OpenCode API
 */
export interface AgentInfo {
  name: string;
  description?: string;
  color?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  steps?: number;
}

/**
 * Agent emoji mapping for visual distinction
 */
export const AGENT_EMOJI: Record<string, string> = {
  plan: "📋",
  build: "🛠️",
  general: "💬",
  explore: "🔍",
  title: "📝",
  summary: "📄",
  compaction: "📦",
};

/**
 * Get emoji for agent (fallback to 🤖 if not found)
 */
export function getAgentEmoji(agentName: string): string {
  return AGENT_EMOJI[agentName] ?? "🤖";
}

/**
 * Get display name for agent (with emoji)
 */
export function getAgentDisplayName(agentName: string): string {
  const emoji = getAgentEmoji(agentName);
  const capitalizedName = agentName.charAt(0).toUpperCase() + agentName.slice(1);
  return `${emoji} ${capitalizedName}`;
}

/**
 * Get reply keyboard label for agent button.
 */
export function getAgentButtonLabel(agentName: string): string {
  return `${getAgentDisplayName(agentName)} Agent`;
}
