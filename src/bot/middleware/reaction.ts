import { Context, NextFunction } from "grammy";
import { pickReactionEmoji } from "../reactions.js";
import { logger } from "../../utils/logger.js";

export async function reactionMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  if (ctx.message && !ctx.message.from?.is_bot) {
    const emoji = pickReactionEmoji();
    ctx.api
      .setMessageReaction(ctx.chat!.id, ctx.message.message_id, [
        { type: "emoji", emoji },
      ])
      .catch((err) => {
        logger.debug(`[Reaction] Failed to react to message ${ctx.message!.message_id}: ${err}`);
      });
  }

  await next();
}
