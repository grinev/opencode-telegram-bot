import type { CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import type { GatewayMonitorCheckName } from "../../gateway/types.js";
import { t } from "../../i18n/index.js";

const CHECKS: readonly GatewayMonitorCheckName[] = ["gateway", "target", "opencode", "wake"];

const CHECK_LABEL_KEYS: Record<GatewayMonitorCheckName, "gateway.check.gateway" | "gateway.check.target" | "gateway.check.opencode" | "gateway.check.wake"> = {
  gateway: "gateway.check.gateway",
  target: "gateway.check.target",
  opencode: "gateway.check.opencode",
  wake: "gateway.check.wake",
};

function checkLabel(check: GatewayMonitorCheckName): string {
  return t(CHECK_LABEL_KEYS[check]);
}

function checkState(healthy: boolean | null): string {
  if (healthy === true) return t("gateway.value.healthy");
  if (healthy === false) return t("gateway.value.unhealthy");
  return t("gateway.value.unknown");
}

export async function monitorCommand(
  ctx: CommandContext<Context>,
  deps: Pick<AppContainer, "gatewayClient" | "gatewayMonitor">,
): Promise<void> {
  if (!deps.gatewayClient.isConfigured()) {
    await ctx.reply(t("gateway.monitor.not_configured"));
    return;
  }
  if (!deps.gatewayMonitor.isEnabled()) {
    await ctx.reply(t("gateway.monitor.disabled"));
    return;
  }

  const snapshot = deps.gatewayMonitor.snapshot();
  const lines = [
    t("gateway.monitor.header"),
    t("gateway.monitor.last_check", {
      time: snapshot.state.lastRunAt ?? t("gateway.monitor.never"),
    }),
  ];

  if (!snapshot.running) {
    lines.push(t("gateway.monitor.not_running"));
  }
  for (const check of CHECKS) {
    const state = snapshot.state.checks[check];
    lines.push(
      t("gateway.monitor.check", {
        check: checkLabel(check),
        status: checkState(state?.healthy ?? null),
        message: state?.message ?? t("gateway.monitor.never"),
      }),
    );
  }

  await ctx.reply(lines.join("\n"));
}
