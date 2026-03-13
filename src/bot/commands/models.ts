import { CommandContext, Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

export async function modelsCommand(ctx: CommandContext<Context>) {
  try {
    const { data: providersData, error } = await opencodeClient.config.providers();

    if (error || !providersData) {
      await ctx.reply(t("legacy.models.fetch_error"));
      return;
    }

    const providers = providersData.providers;

    if (!providers || providers.length === 0) {
      await ctx.reply(t("legacy.models.empty"));
      return;
    }

    let message = t("legacy.models.header");

    for (const provider of providers) {
      message += `🔹 ${provider.id}\n`;

      const models = Object.values(provider.models);
      if (models.length === 0) {
        message += t("legacy.models.no_provider_models");
      } else {
        for (const model of models) {
          message += `  - ${model.id}\n`;
        }
      }
      message += "\n";
    }

    message += t("legacy.models.env_hint");
    message += "OPENCODE_MODEL_PROVIDER=<provider.id>\nOPENCODE_MODEL_ID=<model.id>";

    await ctx.reply(message);
  } catch (error) {
    logger.error("[ModelsCommand] Error listing models:", error);
    await ctx.reply(t("legacy.models.error"));
  }
}
