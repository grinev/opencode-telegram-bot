import { t } from "../../i18n/index.js";
import { getAgentDisplayName } from "../types/agent.js";
import { DURATION_ICON, formatDuration } from "./duration-formatter.js";

/** One assistant message of a run, the unit OpenCode's speed formula sums. */
export interface AssistantRunStep {
  messageID: string;
  created: number;
  streamed?: number;
  output: number;
  reasoning: number;
}

interface AssistantRunFooterParams {
  agent: string;
  providerID: string;
  modelID: string;
  elapsedMs: number;
  steps?: readonly AssistantRunStep[];
  interrupted?: boolean;
}

const SPEED_ICON = "⚡";
const INTERRUPTED_ICON = "⏹";

/**
 * Output and reasoning tokens per second across the run's steps, or undefined until
 * every step has streamed and the totals are positive. Matches OpenCode's sum:
 * each step is weighted by its own stream span, and a negative span counts as zero.
 */
export function assistantRunTokensPerSecond(
  steps: readonly AssistantRunStep[],
): number | undefined {
  if (steps.length === 0 || steps.some((step) => step.streamed === undefined)) {
    return undefined;
  }

  const totalMs = steps.reduce(
    (sum, step) => sum + Math.max(0, (step.streamed ?? 0) - step.created),
    0,
  );
  const tokens = steps.reduce((sum, step) => sum + step.output + step.reasoning, 0);
  if (tokens <= 0 || totalMs <= 0) {
    return undefined;
  }

  return tokens / (totalMs / 1_000);
}

export function formatAssistantRunFooter({
  agent,
  providerID,
  modelID,
  elapsedMs,
  steps,
  interrupted,
}: AssistantRunFooterParams): string {
  const parts = [
    getAgentDisplayName(agent),
    `🧠 ${providerID}/${modelID}`,
    `${DURATION_ICON} ${formatDuration(elapsedMs)}`,
  ];
  const speed = steps ? assistantRunTokensPerSecond(steps) : undefined;
  if (speed !== undefined) {
    parts.push(`${SPEED_ICON} ${speed.toFixed(1)} tok/s`);
  }
  if (interrupted) {
    parts.push(`${INTERRUPTED_ICON} ${t("assistant.footer.interrupted")}`);
  }
  return parts.join(" · ");
}
