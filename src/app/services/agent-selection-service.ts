import { opencodeV2 } from "../../opencode/client.js";
import { getCurrentAgent, getCurrentProject, setCurrentAgent } from "../stores/settings-store.js";
import { getCurrentSession } from "./session-service.js";
import { getStoredModel, selectModel } from "./model-selection-service.js";
import { setCurrentVariant } from "./variant-selection-service.js";
import { logger } from "../../utils/logger.js";
import type { AgentInfo } from "../types/agent.js";

/**
 * Get list of available agents from OpenCode API
 * @returns Array of available agents (filtered by mode and hidden flag)
 */
export async function getAvailableAgents(): Promise<AgentInfo[]> {
  try {
    const project = getCurrentProject();
    const listParams =
      project !== null && project !== undefined
        ? { location: { directory: project.worktree } }
        : undefined;
    const { data: agentsBody, error } = await opencodeV2.agent.list(listParams);

    if (error) {
      logger.error("[AgentManager] Failed to fetch agents:", error);
      return [];
    }

    if (!agentsBody) {
      return [];
    }

    // Filter out hidden agents and subagents (only show primary and all).
    // v2 AgentV2Info.id is the canonical identifier (lowercase, used for
    // switchAgent); `name` is a display label and must NOT be used as the id.
    const filtered: AgentInfo[] = agentsBody.data
      .filter((agent) => !agent.hidden && (agent.mode === "primary" || agent.mode === "all"))
      .map((agent) => {
        const info: AgentInfo = {
          name: agent.id,
          mode: agent.mode,
        };
        if (agent.description !== undefined) {
          info.description = agent.description;
        }
        if (agent.hidden !== undefined) {
          info.hidden = agent.hidden;
        }
        // v2 ModelRef is {id, providerID, variant?}; AgentInfo expects
        // {modelID, providerID} + top-level variant.
        if (agent.model !== undefined) {
          info.model = { modelID: agent.model.id, providerID: agent.model.providerID };
        }
        if (agent.model?.variant !== undefined) {
          info.variant = agent.model.variant;
        }
        return info;
      });

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
    const { data: messagesBody, error } = await opencodeV2.session.messages({
      sessionID: session.id,
      limit: 1,
    });

    if (error || !messagesBody || messagesBody.data.length === 0) {
      logger.debug("[AgentManager] No messages found, using stored agent");
      return resolveProjectAgent(storedAgent ?? DEFAULT_AGENT);
    }

    const lastMessage = messagesBody.data[0];
    const lastAgent =
      lastMessage && lastMessage.type === "assistant" ? lastMessage.agent : undefined;
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

function configuredField(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Apply the listed agent's configured model and/or variant to current settings.
 * Independent fields: a missing or empty one is left as it is. Used only by the
 * agent picker — selectAgent itself stays a name write.
 * @returns true when a model or variant was written (so the pinned dashboard can follow)
 */
export async function applyAgentConfiguredSettings(agentName: string): Promise<boolean> {
  try {
    const agents = await getAvailableAgents();
    const agent = agents.find((entry) => entry.name === agentName);
    if (!agent) {
      logger.warn(
        `[AgentManager] Could not read configured model/variant for agent "${agentName}"; leaving them unchanged`,
      );
      return false;
    }

    const providerID = configuredField(agent.model?.providerID);
    const modelID = configuredField(agent.model?.modelID);
    const variant = configuredField(agent.variant);
    const hasModel = Boolean(providerID && modelID);

    if (hasModel && providerID && modelID) {
      const storedVariant = variant ?? getStoredModel().variant ?? "default";
      selectModel({
        providerID,
        modelID,
        variant: storedVariant,
      });
      logger.info(
        `[AgentManager] Applied agent "${agentName}" model ${providerID}/${modelID} (${storedVariant})`,
      );
      return true;
    }

    if (variant) {
      setCurrentVariant(variant);
      logger.info(`[AgentManager] Applied agent "${agentName}" variant ${variant}`);
      return true;
    }

    return false;
  } catch (err) {
    logger.warn(
      `[AgentManager] Failed to apply configured model/variant for agent "${agentName}"; leaving them unchanged`,
      err,
    );
    return false;
  }
}

/**
 * Get stored agent from settings (synchronous)
 * @returns Current agent name or default "build"
 */
export function getStoredAgent(): string {
  return getCurrentAgent() ?? "build";
}
