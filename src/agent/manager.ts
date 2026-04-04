import { opencodeClient } from "../opencode/client.js";
import { getCurrentProject } from "../settings/manager.js";
import { getCurrentSession } from "../session/manager.js";
import { getCurrentAgent, setCurrentAgent } from "../settings/manager.js";
import { logger } from "../utils/logger.js";
import type { AgentInfo } from "./types.js";

/**
 * Get list of available agents from OpenCode API
 * @returns Array of available agents (filtered by mode and hidden flag)
 */
export async function getAvailableAgents(): Promise<AgentInfo[]> {
  try {
    const project = getCurrentProject();
    const { data: agents, error } = await opencodeClient.app.agents(
      project ? { directory: project.worktree } : undefined,
    );

    if (error) {
      logger.error("[AgentManager] Failed to fetch agents:", error);
      return [];
    }

    if (!agents) {
      return [];
    }

    // Filter out hidden agents and subagents (only show primary and all)
    const filtered = agents.filter(
      (agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"),
    );

    logger.debug(`[AgentManager] Fetched ${filtered.length} available agents`);
    return filtered;
  } catch (err) {
    logger.error("[AgentManager] Error fetching agents:", err);
    return [];
  }
}

const DEFAULT_AGENT = "build";

function pickFallbackAgent(agents: AgentInfo[]): string {
  const defaultAgent = agents.find((agent) => agent.name === DEFAULT_AGENT);
  if (defaultAgent) {
    return defaultAgent.name;
  }

  return agents[0]?.name ?? DEFAULT_AGENT;
}

export async function resolveProjectAgent(preferredAgent?: string): Promise<string> {
  const requestedAgent = preferredAgent ?? getCurrentAgent() ?? DEFAULT_AGENT;
  const project = getCurrentProject();

  if (!project) {
    return requestedAgent;
  }

  const agents = await getAvailableAgents();
  if (agents.length === 0) {
    return requestedAgent;
  }

  if (agents.some((agent) => agent.name === requestedAgent)) {
    return requestedAgent;
  }

  const fallbackAgent = pickFallbackAgent(agents);
  logger.warn(
    `[AgentManager] Agent "${requestedAgent}" is not available for project ${project.worktree}. Falling back to "${fallbackAgent}".`,
  );
  setCurrentAgent(fallbackAgent);
  return fallbackAgent;
}

/**
 * Get current agent from last session message or settings.
 * Falls back to "build" if nothing is stored.
 * @returns Current agent name
 */
export async function fetchCurrentAgent(): Promise<string> {
  const storedAgent = getCurrentAgent();
  const session = getCurrentSession();
  const project = getCurrentProject();

  if (!project) {
    // No active project, return stored agent from settings
    return storedAgent ?? DEFAULT_AGENT;
  }

  if (!session) {
    return resolveProjectAgent(storedAgent ?? DEFAULT_AGENT);
  }

  try {
    const { data: messages, error } = await opencodeClient.session.messages({
      sessionID: session.id,
      directory: project.worktree,
      limit: 1,
    });

    if (error || !messages || messages.length === 0) {
      logger.debug("[AgentManager] No messages found, using stored agent");
      return resolveProjectAgent(storedAgent ?? DEFAULT_AGENT);
    }

    const lastAgent = messages[0].info.agent;
    logger.debug(`[AgentManager] Current agent from session: ${lastAgent}`);

    // If user explicitly selected an agent in bot settings, prefer it.
    // Session messages may contain stale agent until next prompt is sent.
    if (storedAgent && lastAgent !== storedAgent) {
      logger.debug(
        `[AgentManager] Using stored agent "${storedAgent}" instead of session agent "${lastAgent}"`,
      );
      return resolveProjectAgent(storedAgent);
    }

    // No stored agent yet: sync from session history
    if (lastAgent && lastAgent !== storedAgent) {
      setCurrentAgent(lastAgent);
    }

    return resolveProjectAgent(lastAgent || storedAgent || DEFAULT_AGENT);
  } catch (err) {
    logger.error("[AgentManager] Error fetching current agent:", err);
    return resolveProjectAgent(storedAgent ?? DEFAULT_AGENT);
  }
}

/**
 * Select agent and persist to settings
 * @param agentName Name of the agent to select
 */
export function selectAgent(agentName: string): void {
  logger.info(`[AgentManager] Selected agent: ${agentName}`);
  setCurrentAgent(agentName);
}

/**
 * Get stored agent from settings (synchronous)
 * @returns Current agent name or default "build"
 */
export function getStoredAgent(): string {
  return getCurrentAgent() ?? "build";
}
