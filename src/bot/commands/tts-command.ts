import { CommandContext, Context } from "grammy";
import { isTtsConfigured } from "../../app/services/tts-service.js";
import { isTtsEnabled, setTtsEnabled } from "../../app/stores/settings-store.js";
import { t } from "../../i18n/index.js";

export async function ttsCommand(ctx: CommandContext<Context>): Promise<void> {
  const enabled = !isTtsEnabled();

  if (enabled && !isTtsConfigured()) {
    await ctx.reply(t("tts.not_configured"));
    return;
  }

  setTtsEnabled(enabled);

  const message = enabled ? t("tts.enabled") : t("tts.disabled");

  await ctx.reply(message);
}
