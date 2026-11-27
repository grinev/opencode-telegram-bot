import { Context, InlineKeyboard } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { logger } from "../../utils/logger.js";
import type {
  PermissionOutcome,
  PermissionPromptChange,
  PermissionReply,
  PermissionRequest,
} from "../../app/types/permission.js";
import type { I18nKey } from "../../i18n/en.js";
import { t } from "../../i18n/index.js";

const TELEGRAM_MESSAGE_LIMIT = 4096;
const PATTERN_PREFIX = "• ";
const CUT_SUFFIX = "…\n";
const CUT_PATTERNS_LINE = `${PATTERN_PREFIX}${CUT_SUFFIX}`;

const OUTCOME_KEYS: Record<PermissionReply, I18nKey> = {
  once: "permission.outcome.once",
  always: "permission.outcome.always",
  reject: "permission.outcome.reject",
};

export type PermissionInteractionDeps = Pick<AppContainer, "interactionManager">;

export type PermissionMenuDeps = Pick<
  AppContainer,
  "interactionManager" | "permissionManager" | "summaryAggregator"
> & { onAgentPromptShown?: (sessionId: string) => void };

// Permission type display names
const PERMISSION_NAME_KEYS: Record<string, I18nKey> = {
  bash: "permission.name.bash",
  edit: "permission.name.edit",
  write: "permission.name.write",
  read: "permission.name.read",
  webfetch: "permission.name.webfetch",
  websearch: "permission.name.websearch",
  glob: "permission.name.glob",
  grep: "permission.name.grep",
  list: "permission.name.list",
  task: "permission.name.task",
  lsp: "permission.name.lsp",
  external_directory: "permission.name.external_directory",
};

// Permission type emojis
const PERMISSION_EMOJIS: Record<string, string> = {
  bash: "⚡",
  edit: "✏️",
  write: "📝",
  read: "📖",
  webfetch: "🌐",
  websearch: "🔍",
  glob: "📁",
  grep: "🔎",
  list: "📂",
  task: "⚙️",
  lsp: "🔧",
  external_directory: "📁",
};

export function clearPermissionInteraction(
  reason: string,
  deps: PermissionInteractionDeps,
): void {
  const state = deps.interactionManager.getSnapshot();
  if (state?.kind === "permission") {
    deps.interactionManager.clear(reason);
  }
}

export function syncPermissionInteractionState(
  deps: Pick<AppContainer, "interactionManager" | "permissionManager">,
  metadata: Record<string, unknown> = {},
): void {
  const pendingCount = deps.permissionManager.getPendingCount();

  if (pendingCount === 0) {
    clearPermissionInteraction("permission_no_pending_requests", deps);
    return;
  }

  const nextMetadata: Record<string, unknown> = {
    pendingCount,
    ...metadata,
  };

  // Pending prompts exist only while the slot holds permissions.
  deps.interactionManager.transition({
    expectedInput: "callback",
    metadata: nextMetadata,
  });
}

/**
 * Show permission request message with inline buttons
 */
export async function showPermissionRequest(
  bot: Context["api"],
  chatId: number,
  request: PermissionRequest,
  deps: PermissionMenuDeps,
  generation: number = deps.permissionManager.getGeneration(),
): Promise<void> {
  const { interactionManager, permissionManager, summaryAggregator } = deps;
  logger.debug(`[PermissionHandler] Showing permission request: ${request.permission}`);

  // Restores and the event stream can show one request side by side: an equivalent prompt
  // on its way is waited for, then this request joins it or, when it is the same, stops.
  for (
    let inFlight = permissionManager.getPresenting(request);
    inFlight;
    inFlight = permissionManager.getPresenting(request)
  ) {
    await inFlight;
  }

  if (permissionManager.getDropReason(request, generation)) {
    logger.debug(`[PermissionHandler] Skipping stale or already resolved request: ${request.id}`);
    return;
  }

  if (permissionManager.hasRequest(request.id)) {
    logger.debug(`[PermissionHandler] Skipping request already on screen: ${request.id}`);
    return;
  }

  const grouped = permissionManager.addEquivalentRequest(request, generation);
  if (grouped) {
    // Re-render the visible prompt so the user can see the answer will apply
    // to more than one pending request.
    await bot
      .editMessageText(
        chatId,
        grouped.messageId,
        formatPermissionText(grouped.request, grouped.count),
        { reply_markup: buildPermissionKeyboard() },
      )
      .catch((err) => {
        logger.warn("[PermissionHandler] Failed to update grouped permission message:", err);
      });

    syncPermissionInteractionState(deps, {
      requestID: request.id,
      messageId: grouped.messageId,
      deduplicated: true,
      groupedCount: grouped.count,
    });
    summaryAggregator.stopTypingIndicator();
    return;
  }

  const text = formatPermissionText(request);
  const keyboard = buildPermissionKeyboard();
  const releasePresenting = permissionManager.claimPresenting(request);

  try {
    const message = await bot.sendMessage(chatId, text, {
      reply_markup: keyboard,
    });

    logger.debug(`[PermissionHandler] Message sent, messageId=${message.message_id}`);
    const result = permissionManager.startPermission(request, message.message_id, generation);
    if (result !== "started") {
      if (result === "question_active") {
        // A poll took the slot while this prompt was being sent: it waits for the poll.
        interactionManager.waitPermission(request);
      }

      await bot.deleteMessage(chatId, message.message_id).catch((err) => {
        logger.warn(`[PermissionHandler] Failed to delete unregistered permission message:`, err);
      });
      return;
    }

    syncPermissionInteractionState(deps, {
      requestID: request.id,
      messageId: message.message_id,
    });

    deps.onAgentPromptShown?.(request.sessionID);
    summaryAggregator.stopTypingIndicator();
  } catch (err) {
    logger.error("[PermissionHandler] Failed to send permission message:", err);
    throw err;
  } finally {
    releasePresenting();
  }
}

/**
 * Edit prompts whose requests changed: an ended prompt keeps its text and gets its
 * outcome line instead of the buttons, a prompt left with fewer grouped requests shows
 * the lower count. Then the slot follows what is still open.
 */
export async function applyPermissionPromptChanges(
  bot: Context["api"],
  chatId: number,
  changes: PermissionPromptChange[],
  deps: Pick<AppContainer, "interactionManager" | "permissionManager">,
): Promise<void> {
  for (const change of changes) {
    const edit = change.outcome
      ? bot.editMessageText(
          chatId,
          change.messageId,
          formatPermissionText(change.request, 1, formatOutcomeLine(change.outcome)),
        )
      : bot.editMessageText(
          chatId,
          change.messageId,
          formatPermissionText(change.request, change.openCount),
          { reply_markup: buildPermissionKeyboard() },
        );

    await edit.catch((err) => {
      logger.warn(`[PermissionHandler] Failed to update permission prompt ${change.messageId}:`, err);
    });
  }

  if (changes.length > 0) {
    syncPermissionInteractionState(deps);
  }
}

/**
 * The answer did not reach OpenCode: the prompt stays answerable and says so. When the
 * prompt cannot be edited, the warning comes as a message of its own.
 */
export async function showPermissionDeliveryWarning(
  bot: Context["api"],
  chatId: number,
  change: PermissionPromptChange,
  deps: Pick<AppContainer, "interactionManager" | "permissionManager">,
): Promise<void> {
  const warning = t("permission.delivery_failed");

  try {
    await bot.editMessageText(
      chatId,
      change.messageId,
      formatPermissionText(change.request, change.openCount, warning),
      { reply_markup: buildPermissionKeyboard() },
    );
  } catch (err) {
    if (isMessageNotModifiedError(err)) {
      // The warning from an earlier failed tap is still on the prompt.
      syncPermissionInteractionState(deps);
      return;
    }

    logger.warn(`[PermissionHandler] Failed to show the delivery warning in the prompt:`, err);
    await bot.sendMessage(chatId, warning).catch((sendErr) => {
      logger.error("[PermissionHandler] Failed to send the delivery warning:", sendErr);
    });
  }

  syncPermissionInteractionState(deps);
}

function isMessageNotModifiedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("message is not modified");
}

function formatOutcomeLine(outcome: PermissionOutcome): string {
  switch (outcome.kind) {
    case "replied": {
      const line = t(OUTCOME_KEYS[outcome.reply]);
      return outcome.outside ? `${line}${t("permission.outcome.outside_suffix")}` : line;
    }
    case "settled_outside":
      return t("permission.outcome.settled_outside");
    case "not_answered":
      return t("permission.outcome.not_answered");
  }
}

/**
 * Format permission request text, optionally closed by a status line. Patterns are cut
 * when the whole text would not fit into one Telegram message.
 */
function formatPermissionText(
  request: PermissionRequest,
  groupedCount: number = 1,
  statusLine?: string,
): string {
  const emoji = PERMISSION_EMOJIS[request.permission] || "🔐";
  const nameKey = PERMISSION_NAME_KEYS[request.permission];
  const name = nameKey ? t(nameKey) : request.permission;

  const header = t("permission.header", { emoji, name });
  const grouped = groupedCount > 1 ? t("permission.grouped_count", { count: groupedCount }) : "";
  const status = statusLine ? `\n${statusLine}` : "";

  // Show patterns (commands/files)
  let budget = TELEGRAM_MESSAGE_LIMIT - header.length - grouped.length - status.length;
  let patterns = "";
  for (const [index, pattern] of request.patterns.entries()) {
    const line = `${PATTERN_PREFIX}${pattern}\n`;
    // Keep room for the cut marker while more patterns follow.
    const reserve = index === request.patterns.length - 1 ? 0 : CUT_PATTERNS_LINE.length;
    if (line.length + reserve <= budget) {
      patterns += line;
      budget -= line.length;
      continue;
    }

    // The pattern that does not fit is shortened, so the user still sees what is asked.
    const room = budget - CUT_PATTERNS_LINE.length;
    patterns +=
      room > 0
        ? `${PATTERN_PREFIX}${sliceOnSafeBoundary(pattern, room)}${CUT_SUFFIX}`
        : CUT_PATTERNS_LINE;
    break;
  }

  return `${header}${patterns}${grouped}${status}`;
}

function sliceOnSafeBoundary(text: string, maxLength: number): string {
  const end = Math.min(text.length, maxLength);
  const code = text.charCodeAt(end - 1);
  // Never split a surrogate pair.
  return text.slice(0, code >= 0xd800 && code <= 0xdbff ? end - 1 : end);
}

/**
 * Build inline keyboard with permission buttons
 */
function buildPermissionKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text(t("permission.button.allow"), "permission:once").row();
  keyboard.text(t("permission.button.always"), "permission:always").row();
  keyboard.text(t("permission.button.reject"), "permission:reject");

  return keyboard;
}
