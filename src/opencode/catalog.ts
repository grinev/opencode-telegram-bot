import { opencodeV2, toError } from "./client.js";
import type { ModelV2Info, ProviderV2Info } from "@opencode-ai/sdk/v2";

export interface ModelCatalog {
  providers: ProviderV2Info[];
  models: ModelV2Info[];
}

// opencode v2 serves providers and models from separate endpoints
// (/api/provider, /api/model); v1 nested models inside config.providers.
export async function fetchModelCatalog(): Promise<{
  data: ModelCatalog | null;
  error: Error | null;
}> {
  try {
    const [providersRes, modelsRes] = await Promise.all([
      opencodeV2.provider.list(),
      opencodeV2.model.list(),
    ]);

    if (providersRes.error || !providersRes.data) {
      return {
        data: null,
        error: toError(providersRes.error, "No provider data received from server"),
      };
    }

    if (modelsRes.error || !modelsRes.data) {
      return {
        data: null,
        error: toError(modelsRes.error, "No model data received from server"),
      };
    }

    return {
      data: { providers: providersRes.data.data, models: modelsRes.data.data },
      error: null,
    };
  } catch (error) {
    return { data: null, error: toError(error, "Failed to fetch model catalog") };
  }
}

export function findCatalogModel(
  catalog: ModelCatalog,
  providerID: string,
  modelID: string,
): ModelV2Info | undefined {
  return catalog.models.find((model) => model.providerID === providerID && model.id === modelID);
}
