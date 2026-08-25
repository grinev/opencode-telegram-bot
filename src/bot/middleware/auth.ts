import { Context, NextFunction } from "grammy";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
import { userScope } from "../../app/stores/user-scope.js";

// Multi-operator allowlist: allowedUserIds absorbs the legacy single-user
// variable, so single-operator deployments behave exactly as before.
const isAllowed = (userId: number): boolean => config.telegram.allowedUserIds.includes(userId);

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;

  logger.debug(
    `[Auth] Checking access: userId=${userId}, allowedUsers=${config.telegram.allowedUserIds.join(",")}, hasCallbackQuery=${!!ctx.callbackQuery}, hasMessage=${!!ctx.message}`,
  );

  if (userId && isAllowed(userId)) {
    logger.debug(`[Auth] Access granted for userId=${userId}`);
    // Tag every update with its sender so session state resolves per operator.
    await userScope.run({ userId }, next);
  } else {
    // Silently ignore unauthorized users
    logger.warn(`Unauthorized access attempt from user ID: ${userId}`);

    // Actively hide commands for unauthorized users by setting empty command list
    // Only do this if the chat is NOT an authorized user's chat
    // (to avoid resetting commands when forwarded messages are received)
    if (ctx.chat?.id && !isAllowed(ctx.chat.id)) {
      try {
        // Set empty commands for this specific chat (more reliable than deleteMyCommands)
        await ctx.api.setMyCommands([], {
          scope: { type: "chat", chat_id: ctx.chat.id },
        });
        logger.debug(`[Auth] Set empty commands for unauthorized chat_id=${ctx.chat.id}`);
      } catch (err) {
        // Ignore errors
        logger.debug(`[Auth] Could not set empty commands: ${err}`);
      }
    }
  }
}
