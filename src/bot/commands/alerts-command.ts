import type { CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { t } from "../../i18n/index.js";
import { formatGatewayAlert } from "../../gateway/monitor-service.js";

export async function alertsCommand(
  ctx: CommandContext<Context>,
  deps: Pick<AppContainer, "gatewayClient" | "gatewayMonitor">,
): Promise<void> {
  if (!deps.gatewayClient.isConfigured()) {
    await ctx.reply(t("gateway.monitor.not_configured"));
    return;
  }

  const alerts = deps.gatewayMonitor.snapshot().state.alerts.slice(-10).reverse();
  if (alerts.length === 0) {
    await ctx.reply(t("gateway.alerts.empty"));
    return;
  }

  const lines = [t("gateway.alerts.header")];
  for (const alert of alerts) {
    lines.push(`${alert.createdAt} — ${formatGatewayAlert(alert)}`);
  }
  await ctx.reply(lines.join("\n"));
}
