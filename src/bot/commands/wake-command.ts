import type { CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { t } from "../../i18n/index.js";

export async function wakeCommand(
  ctx: CommandContext<Context>,
  deps: Pick<AppContainer, "gatewayClient">,
): Promise<void> {
  if (!deps.gatewayClient.isConfigured()) {
    await ctx.reply(t("gateway.error.unavailable"));
    return;
  }

  await ctx.reply(t("gateway.wake.starting"));
  try {
    const result = await deps.gatewayClient.wake();
    if (!result.ready) {
      await ctx.reply(t("gateway.wake.failed", { error: result.error ?? "unknown error" }));
      return;
    }

    await ctx.reply(
      t("gateway.wake.success", {
        woke: result.woke ? "yes" : "no",
        duration: `${result.wakeDurationMs} ms`,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await ctx.reply(t("gateway.wake.failed", { error: message }));
  }
}
