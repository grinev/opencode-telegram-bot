import { t } from "../i18n/index.js";

export const DEFAULT_CONTEXT_LIMIT = 200000;

export function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }

  if (count >= 1000) {
    return `${Math.round(count / 1000)}K`;
  }

  return count.toString();
}

export function formatModelDisplayName(
  providerID?: string | null,
  modelID?: string | null,
): string {
  if (providerID && modelID) {
    return `${providerID}/${modelID}`;
  }

  return t("pinned.unknown");
}

export function formatContextLine(tokensUsed: number, tokensLimit?: number | null): string {
  const safeLimit = typeof tokensLimit === "number" && tokensLimit > 0 ? tokensLimit : null;
  const percentage = safeLimit ? Math.round((tokensUsed / safeLimit) * 100) : 0;

  return t("pinned.line.context", {
    used: formatTokenCount(tokensUsed),
    limit: safeLimit ? formatTokenCount(safeLimit) : t("pinned.unknown"),
    percent: percentage,
  });
}

export function formatCostLine(cost: number): string {
  return t("pinned.line.cost", { cost: `$${cost.toFixed(2)}` });
}
