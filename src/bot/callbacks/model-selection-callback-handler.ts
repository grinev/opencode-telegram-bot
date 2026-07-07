import { Context, InlineKeyboard } from "grammy";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import {
  getModelSelectionLists,
  searchModels,
  selectModel,
} from "../../app/services/model-selection-service.js";
import { formatVariantForButton } from "../../app/services/variant-selection-service.js";
import { formatModelForDisplay } from "../../app/types/model.js";
import type { ModelInfo } from "../../app/types/model.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";
import { clearActiveInlineMenu, ensureActiveInlineMenu } from "../menus/inline-menu.js";
import {
  MODEL_LIST_CALLBACK_PREFIX,
  MODEL_SEARCH_AGAIN_CALLBACK,
  MODEL_SEARCH_CALLBACK,
  MODEL_SEARCH_CANCEL_CALLBACK,
} from "../menus/model-selection-menu.js";

const MODEL_SEARCH_RESULT_CALLBACK_PREFIX = "model:result:";

interface ModelSearchMetadata {
  flow: string;
  stage: string;
  messageId?: number;
  models: ModelInfo[];
}

function parseModelItems(value: unknown): ModelInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("providerID" in item) ||
      !("modelID" in item)
    ) {
      return [];
    }

    const providerID = item.providerID;
    const modelID = item.modelID;
    if (typeof providerID !== "string" || typeof modelID !== "string") {
      return [];
    }

    const variant =
      "variant" in item && typeof item.variant === "string" ? item.variant : "default";
    return [{ providerID, modelID, variant }];
  });
}

function parseModelSearchMetadata(): ModelSearchMetadata | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "custom") {
    return null;
  }

  const flow = state.metadata.flow;
  const stage = state.metadata.stage;

  if (flow !== "model-search" || typeof stage !== "string") {
    return null;
  }

  const messageId =
    typeof state.metadata.messageId === "number" ? state.metadata.messageId : undefined;

  return { flow, stage, messageId, models: parseModelItems(state.metadata.models) };
}

function parseNonNegativeIndex(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const index = Number.parseInt(value, 10);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

function parseCallbackIndex(data: string, prefix: string): number | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  return parseNonNegativeIndex(data.slice(prefix.length));
}

async function resolveModelListCallback(data: string): Promise<ModelInfo | null> {
  if (!data.startsWith(MODEL_LIST_CALLBACK_PREFIX)) {
    return null;
  }

  const parts = data.slice(MODEL_LIST_CALLBACK_PREFIX.length).split(":");
  if (parts.length !== 2) {
    return null;
  }

  const [kind, indexText] = parts;
  const index = parseNonNegativeIndex(indexText);
  if ((kind !== "favorites" && kind !== "recent") || index === null) {
    return null;
  }

  const lists = await getModelSelectionLists();
  const model = kind === "favorites" ? lists.favorites[index] : lists.recent[index];
  if (!model) {
    return null;
  }

  return {
    providerID: model.providerID,
    modelID: model.modelID,
    variant: "default",
  };
}

function parseLegacyModelCallback(data: string): ModelInfo | null {
  const parts = data.split(":");
  if (parts.length < 3) {
    return null;
  }

  const providerID = parts[1];
  const modelID = parts.slice(2).join(":");
  if (!providerID || !modelID) {
    return null;
  }

  return {
    providerID,
    modelID,
    variant: "default",
  };
}

function isShortModelCallback(data: string): boolean {
  return (
    data.startsWith(MODEL_SEARCH_RESULT_CALLBACK_PREFIX) ||
    data.startsWith(MODEL_LIST_CALLBACK_PREFIX)
  );
}

/**
 * Shared logic for applying a model selection and updating UI.
 * Used by both the regular inline menu flow and the search results flow.
 */
async function applyModelSelectionAndNotify(ctx: Context, modelInfo: ModelInfo): Promise<void> {
  if (ctx.chat) {
    keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  selectModel(modelInfo);
  keyboardManager.updateModel(modelInfo);
  await pinnedMessageManager.refreshContextLimit();

  const currentAgent = await resolveProjectAgent(getStoredAgent());
  const contextInfo =
    pinnedMessageManager.getContextInfo() ??
    (pinnedMessageManager.getContextLimit() > 0
      ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
      : null);

  keyboardManager.updateAgent(currentAgent);

  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }

  const variantName = formatVariantForButton(modelInfo.variant || "default");
  const keyboard = createMainKeyboard(
    currentAgent,
    modelInfo,
    contextInfo ?? undefined,
    variantName,
  );
  const displayName = formatModelForDisplay(modelInfo.providerID, modelInfo.modelID);

  await ctx.answerCallbackQuery({ text: t("model.changed_callback", { name: displayName }) });
  await ctx.reply(t("model.changed_message", { name: displayName }), {
    reply_markup: keyboard,
  });
  await ctx.deleteMessage().catch(() => {});
}

/**
 * Handle model selection callback from the inline menu.
 * Skips search-related callbacks (handled separately).
 * @returns true if handled, false otherwise
 */
export async function handleModelSelect(ctx: Context): Promise<boolean> {
  const callbackQuery = ctx.callbackQuery;

  if (!callbackQuery?.data || !callbackQuery.data.startsWith("model:")) {
    return false;
  }

  // Skip search callbacks — handled by handleModelSearchCallback / handleModelSearchResults
  if (
    callbackQuery.data === MODEL_SEARCH_CALLBACK ||
    callbackQuery.data === MODEL_SEARCH_AGAIN_CALLBACK ||
    callbackQuery.data === MODEL_SEARCH_CANCEL_CALLBACK
  ) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "model");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[ModelHandler] Received callback: ${callbackQuery.data}`);

  try {
    const modelInfo = await resolveModelListCallback(callbackQuery.data);
    const shouldUseLegacyFallback = !isShortModelCallback(callbackQuery.data);
    const resolvedModelInfo =
      modelInfo ?? (shouldUseLegacyFallback ? parseLegacyModelCallback(callbackQuery.data) : null);

    if (!resolvedModelInfo) {
      logger.error(`[ModelHandler] Invalid callback data format: ${callbackQuery.data}`);
      clearActiveInlineMenu("model_select_invalid_callback");
      await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
      return true;
    }

    clearActiveInlineMenu("model_selected");
    await applyModelSelectionAndNotify(ctx, resolvedModelInfo);

    return true;
  } catch (err) {
    clearActiveInlineMenu("model_select_error");
    logger.error("[ModelHandler] Error handling model select:", err);
    await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
    return false;
  }
}

/**
 * Handle the search button callback (model:search) from the inline menu.
 * Transitions the interaction to text-input mode and prompts the user.
 */
export async function handleModelSearchCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  if (data !== MODEL_SEARCH_CALLBACK) {
    return false;
  }

  const isActive = await ensureActiveInlineMenu(ctx, "model");
  if (!isActive) {
    return true;
  }

  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.deleteMessage().catch(() => {});

  // Start a new interaction for search text input
  // interactionManager.start() clears any existing interaction automatically
  interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    metadata: {
      flow: "model-search",
      stage: "input",
    },
  });

  await ctx.reply(t("model.search.prompt"));

  logger.debug("[ModelHandler] Model search prompt shown");
  return true;
}

/**
 * Handle text input for model search.
 * Searches the full provider catalog and shows results (or "not found").
 */
export async function handleModelSearchTextInput(ctx: Context): Promise<boolean> {
  const meta = parseModelSearchMetadata();
  if (!meta || meta.stage !== "input") {
    return false;
  }

  const text = ctx.message?.text;
  if (!text) {
    return false;
  }

  logger.debug(`[ModelHandler] Model search query: "${text}"`);

  try {
    const results = await searchModels(text);

    const keyboard = new InlineKeyboard();

    for (const [index, model] of results.entries()) {
      const label = `${model.providerID}/${model.modelID}`;
      keyboard.text(label, `${MODEL_SEARCH_RESULT_CALLBACK_PREFIX}${index}`).row();
    }

    keyboard.row();
    keyboard.text(t("model.search.search_again"), MODEL_SEARCH_AGAIN_CALLBACK);
    keyboard.text(t("inline.button.cancel"), MODEL_SEARCH_CANCEL_CALLBACK);

    const replyText =
      results.length === 0
        ? t("model.search.no_results", { query: text })
        : t("model.search.results_title", { query: text });

    const sent = await ctx.reply(replyText, { reply_markup: keyboard });

    // Transition to results stage (callback-only)
    interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        flow: "model-search",
        stage: "results",
        messageId: sent.message_id,
        models: results.map((model) => ({
          providerID: model.providerID,
          modelID: model.modelID,
          variant: "default",
        })),
      },
    });

    return true;
  } catch (err) {
    logger.error("[ModelHandler] Model search error:", err);
    await ctx.reply(t("model.search.error"));
    interactionManager.clear("model_search_error");
    return true;
  }
}

/**
 * Handle callbacks from the search results menu:
 * - model:search:cancel — clears interaction, deletes message
 * - model:search:again — delegates to handleModelSearchCallback
 * - model:provider:model — selects the model from search results
 */
export async function handleModelSearchResults(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data) {
    return false;
  }

  const meta = parseModelSearchMetadata();
  if (!meta || meta.stage !== "results") {
    return false;
  }

  // Verify message ID matches to reject stale callbacks
  const callbackMessageId = ctx.callbackQuery?.message?.message_id;
  if (meta.messageId !== undefined && callbackMessageId !== meta.messageId) {
    await ctx
      .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
      .catch(() => {});
    return true;
  }

  // Cancel
  if (data === MODEL_SEARCH_CANCEL_CALLBACK) {
    interactionManager.clear("model_search_cancelled");
    await ctx.answerCallbackQuery({ text: t("inline.cancelled_callback") }).catch(() => {});
    await ctx.deleteMessage().catch(() => {});
    return true;
  }

  // Search again — inline implementation
  if (data === MODEL_SEARCH_AGAIN_CALLBACK) {
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.deleteMessage().catch(() => {});

    interactionManager.start({
      kind: "custom",
      expectedInput: "text",
      metadata: {
        flow: "model-search",
        stage: "input",
      },
    });

    await ctx.reply(t("model.search.prompt"));

    logger.debug("[ModelHandler] Model search prompt shown (search again)");
    return true;
  }

  const resultIndex = parseCallbackIndex(data, MODEL_SEARCH_RESULT_CALLBACK_PREFIX);
  if (resultIndex !== null) {
    const modelInfo = meta.models[resultIndex];
    if (!modelInfo) {
      await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
      return true;
    }

    interactionManager.clear("model_search_selected");
    await applyModelSelectionAndNotify(ctx, modelInfo);
    return true;
  }

  // Backward compatibility for callbacks from already-rendered search result messages.
  if (data.startsWith("model:")) {
    if (isShortModelCallback(data)) {
      logger.error(`[ModelHandler] Invalid search result callback data: ${data}`);
      await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
      return true;
    }

    const modelInfo = parseLegacyModelCallback(data);
    if (!modelInfo) {
      return true;
    }

    interactionManager.clear("model_search_selected");
    await applyModelSelectionAndNotify(ctx, modelInfo);
    return true;
  }

  return false;
}
