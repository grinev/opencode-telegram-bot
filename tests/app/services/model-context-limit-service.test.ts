import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { providersMock } = vi.hoisted(() => ({
  providersMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: providersMock,
    },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  __resetModelContextLimitCacheForTests,
  DEFAULT_CONTEXT_LIMIT,
  getModelContextLimit,
} from "../../../src/app/services/model-context-limit-service.js";

function createProvidersResponse(limitsByModel: Record<string, number>) {
  const modelsByProvider = new Map<string, Record<string, { limit: { context: number } }>>();

  for (const [key, context] of Object.entries(limitsByModel)) {
    const [providerID, modelID] = key.split("/") as [string, string];
    const models = modelsByProvider.get(providerID) ?? {};
    models[modelID] = { limit: { context } };
    modelsByProvider.set(providerID, models);
  }

  return {
    data: {
      providers: Array.from(modelsByProvider, ([id, models]) => ({ id, models })),
    },
    error: null,
  };
}

describe("app/services/model-context-limit-service", () => {
  beforeEach(() => {
    __resetModelContextLimitCacheForTests();
    providersMock.mockReset();
    providersMock.mockResolvedValue(createProvidersResponse({ "openai/gpt-4o": 128000 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the model's context limit and caches it", async () => {
    await expect(getModelContextLimit("openai", "gpt-4o")).resolves.toBe(128000);
    await expect(getModelContextLimit("openai", "gpt-4o")).resolves.toBe(128000);

    expect(providersMock).toHaveBeenCalledTimes(1);
  });

  it("does not keep a providers list without models", async () => {
    providersMock.mockResolvedValueOnce(createProvidersResponse({}));

    await expect(getModelContextLimit("openai", "gpt-4o")).resolves.toBe(DEFAULT_CONTEXT_LIMIT);
    await expect(getModelContextLimit("openai", "gpt-4o")).resolves.toBe(128000);

    expect(providersMock).toHaveBeenCalledTimes(2);
  });

  it("keeps limits cached before an empty providers list", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await getModelContextLimit("openai", "gpt-4o");

    vi.setSystemTime(new Date("2026-01-01T00:11:00.000Z"));
    providersMock.mockResolvedValueOnce(createProvidersResponse({}));

    await expect(getModelContextLimit("anthropic", "claude")).resolves.toBe(DEFAULT_CONTEXT_LIMIT);
    await expect(getModelContextLimit("openai", "gpt-4o")).resolves.toBe(128000);
  });

  it("returns the default limit for a model the list does not name", async () => {
    await expect(getModelContextLimit("anthropic", "claude")).resolves.toBe(DEFAULT_CONTEXT_LIMIT);
  });
});
