import { Context, InlineKeyboard } from "grammy";
import { getStoredAgent, resolveProjectAgent } from "../../app/services/agent-selection-service.js";
import {
  fetchCurrentModel,
  getModelSelectionLists,
  getProviderModels,
  getProviders,
  searchModels,
  selectModel,
} from "../../app/services/model-selection-service.js";
import { formatVariantForButton } from "../../app/services/variant-selection-service.js";
import { formatModelForDisplay } from "../../app/types/model.js";
import type { ModelInfo, ProviderInfo } from "../../app/types/model.js";
import { interactionManager } from "../../app/managers/interaction-manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { cancelMenu, failure, switched } from "./feedback.js";
import { createMainKeyboard } from "../keyboards/main-reply-keyboard.js";
import { keyboardManager } from "../keyboards/keyboard-manager.js";
import { pinnedMessageManager } from "../pinned/pinned-message-manager.js";
import {
  appendInlineMenuCancelButton,
  clearActiveInlineMenu,
  ensureActiveInlineMenu,
} from "../menus/inline-menu.js";
import { showVariantSelectionMenuAfterModelChange } from "../menus/variant-selection-menu.js";
import {
  buildModelRootMenuView,
  buildProviderModelsMenuView,
  buildProvidersMenuView,
  MODEL_LIST_CALLBACK_PREFIX,
  MODEL_PROVIDER_CALLBACK_PREFIX,
  MODEL_PROVIDER_MODEL_CALLBACK_PREFIX,
  MODEL_PROVIDERS_CALLBACK_PREFIX,
  MODEL_ROOT_CALLBACK,
  MODEL_SEARCH_AGAIN_CALLBACK,
  MODEL_SEARCH_CALLBACK,
  MODEL_SEARCH_CANCEL_CALLBACK,
  parseProviderCallback,
  parseProviderModelCallback,
  parseProvidersPageCallback,
} from "../menus/model-selection-menu.js";

const MODEL_SEARCH_RESULT_CALLBACK_PREFIX = "model:result:";

interface ModelSearchMetadata {
  flow: string;
  stage: string;
  messageId?: number | undefined;
  models: ModelInfo[];
}

interface ModelListMetadata {
  favorites: ModelInfo[];
  recent: ModelInfo[];
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

function parseModelListMetadata(): ModelListMetadata | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "inline" || state.metadata.menuKind !== "model") {
    return null;
  }

  const modelLists = state.metadata.modelLists;
  if (typeof modelLists !== "object" || modelLists === null) {
    return null;
  }

  return {
    favorites: parseModelItems("favorites" in modelLists ? modelLists.favorites : undefined),
    recent: parseModelItems("recent" in modelLists ? modelLists.recent : undefined),
  };
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

function resolveModelListCallback(data: string): ModelInfo | null {
  if (!data.startsWith(MODEL_LIST_CALLBACK_PREFIX)) {
    return null;
  }

  const parts = data.slice(MODEL_LIST_CALLBACK_PREFIX.length).split(":");
  if (parts.length !== 2) {
    return null;
  }

  const [kind, indexText] = parts;
  if (!kind || !indexText) {
    return null;
  }
  const index = parseNonNegativeIndex(indexText);
  if ((kind !== "favorites" && kind !== "recent") || index === null) {
    return null;
  }

  const lists = parseModelListMetadata();
  if (!lists) {
    return null;
  }

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
    data.startsWith(MODEL_LIST_CALLBACK_PREFIX) ||
    isProviderBrowserCallback(data)
  );
}

function isProviderBrowserCallback(data: string): boolean {
  return (
    data === MODEL_ROOT_CALLBACK ||
    data.startsWith(MODEL_PROVIDERS_CALLBACK_PREFIX) ||
    data.startsWith(MODEL_PROVIDER_CALLBACK_PREFIX) ||
    data.startsWith(MODEL_PROVIDER_MODEL_CALLBACK_PREFIX)
  );
}

function parseProviderItems(value: unknown): ProviderInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("id" in item) || !("name" in item)) {
      return [];
    }

    const { id, name } = item as { id: unknown; name: unknown };
    if (typeof id !== "string" || typeof name !== "string") {
      return [];
    }

    const modelCount =
      "modelCount" in item && typeof (item as { modelCount: unknown }).modelCount === "number"
        ? (item as { modelCount: number }).modelCount
        : 0;

    return [{ id, name, modelCount }];
  });
}

interface ProviderBrowserMetadata {
  providers: ProviderInfo[];
  providersPage: number;
  models: ModelInfo[];
}

function parseProviderBrowserMetadata(): ProviderBrowserMetadata | null {
  const state = interactionManager.getSnapshot();
  if (!state || state.kind !== "inline" || state.metadata.menuKind !== "model") {
    return null;
  }

  return {
    providers: parseProviderItems(state.metadata.providers),
    providersPage:
      typeof state.metadata.providersPage === "number" ? state.metadata.providersPage : 0,
    models: parseModelItems(state.metadata.models),
  };
}

function updateModelMenuMetadata(metadata: Record<string, unknown>): void {
  const state = interactionManager.getSnapshot();

  interactionManager.transition({
    expectedInput: "callback",
    metadata: {
      ...metadata,
      menuKind: "model",
      messageId: state?.metadata.messageId,
    },
  });
}

async function renderModelMenuScreen(
  ctx: Context,
  view: { text: string; keyboard: InlineKeyboard },
): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => {});
  await ctx.editMessageText(view.text, {
    reply_markup: appendInlineMenuCancelButton(view.keyboard, "model"),
  });
}

async function showProvidersScreen(ctx: Context, page: number): Promise<void> {
  const providers = await getProviders();
  const view = buildProvidersMenuView(providers, page);

  await renderModelMenuScreen(ctx, view);
  updateModelMenuMetadata({ providers, providersPage: view.page });
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

  await switched(ctx, t("model.changed_message", { name: displayName }), keyboard);
  await showVariantSelectionMenuAfterModelChange(ctx, modelInfo);
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

  // Skip provider browser callbacks — handled by handleModelProvidersCallback
  if (isProviderBrowserCallback(callbackQuery.data)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "model");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[ModelHandler] Received callback: ${callbackQuery.data}`);

  try {
    const modelInfo = resolveModelListCallback(callbackQuery.data);
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
    await failure(ctx, "model.change_error_callback");
    return true;
  }
}

/**
 * Handle the provider browser callbacks from the model inline menu:
 * - model:root — back to the favorites/recent menu
 * - model:providers:<page> — providers list
 * - model:provider:<providerIndex>:<page> — models of a provider
 * - model:pick:<index> — select a model from the current provider page
 * @returns true if handled, false otherwise
 */
export async function handleModelProvidersCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !isProviderBrowserCallback(data)) {
    return false;
  }

  const isActiveMenu = await ensureActiveInlineMenu(ctx, "model");
  if (!isActiveMenu) {
    return true;
  }

  logger.debug(`[ModelHandler] Received provider browser callback: ${data}`);

  try {
    if (data === MODEL_ROOT_CALLBACK) {
      const modelLists = await getModelSelectionLists();
      const view = await buildModelRootMenuView(fetchCurrentModel(), modelLists);

      await renderModelMenuScreen(ctx, view);
      updateModelMenuMetadata({ modelLists });
      return true;
    }

    const providersPage = parseProvidersPageCallback(data);
    if (providersPage !== null) {
      await showProvidersScreen(ctx, providersPage);
      return true;
    }

    const providerCallback = parseProviderCallback(data);
    if (providerCallback) {
      const meta = parseProviderBrowserMetadata();
      const provider = meta?.providers[providerCallback.providerIndex];

      if (!provider) {
        logger.warn(`[ModelHandler] Unresolved provider callback: ${data}`);
        await ctx
          .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
          .catch(() => {});
        return true;
      }

      const models = await getProviderModels(provider.id);
      const view = buildProviderModelsMenuView(
        provider,
        providerCallback.providerIndex,
        models,
        providerCallback.page,
        meta.providersPage,
        fetchCurrentModel(),
      );

      await renderModelMenuScreen(ctx, view);
      updateModelMenuMetadata({
        providers: meta.providers,
        providersPage: meta.providersPage,
        models: view.pageModels.map((model) => ({
          providerID: model.providerID,
          modelID: model.modelID,
          variant: "default",
        })),
      });
      return true;
    }

    const modelIndex = parseProviderModelCallback(data);
    if (modelIndex !== null) {
      const meta = parseProviderBrowserMetadata();
      const modelInfo = meta?.models[modelIndex];

      if (!modelInfo) {
        logger.warn(`[ModelHandler] Unresolved provider model callback: ${data}`);
        await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
        return true;
      }

      clearActiveInlineMenu("model_selected");
      await applyModelSelectionAndNotify(ctx, modelInfo);
      return true;
    }

    return false;
  } catch (err) {
    logger.error("[ModelHandler] Error handling provider browser callback:", err);
    await ctx.answerCallbackQuery({ text: t("model.providers.error") }).catch(() => {});
    return true;
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
    await cancelMenu(ctx);
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
