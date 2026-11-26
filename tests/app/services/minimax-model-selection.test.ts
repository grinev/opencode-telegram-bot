import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const state = vi.hoisted(() => ({
  http: vi.fn<typeof fetch>(),
  version: "v1" as "v1" | "v2",
  selected: undefined as { providerID: string; modelID: string; variant?: string } | undefined,
}));

vi.mock("../../../src/opencode/client.js", async () => {
  const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
  const { createV2OpencodeClient } = await import("../../../src/opencode/v2/client.js");
  const v1 = createOpencodeClient({ baseUrl: "http://opencode.test", fetch: state.http });
  return {
    get opencodeServerVersion() {
      return state.version;
    },
    get opencodeClient() {
      return state.version === "v1"
        ? v1
        : createV2OpencodeClient({ baseUrl: "http://opencode.test" });
    },
  };
});
vi.mock("../../../src/app/stores/settings-store.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCurrentModel: () => state.selected,
  setCurrentModel: (model: typeof state.selected) => {
    state.selected = model;
  },
}));

import { config } from "../../../src/config.js";
import { opencodeClient } from "../../../src/opencode/client.js";
import {
  getModelAvailability,
  getModelSelectionLists,
  getProviderModels,
  getProviders,
  getStoredModel,
  reconcileStoredModelSelection,
  searchModels,
  selectModel,
} from "../../../src/app/services/model-selection-service.js";
import { prepareHandedOverPrompt } from "../../../src/bot/handlers/prompt.js";
import type { Context } from "grammy";

const routes = [
  ["minimax", "MiniMax-M3.1-Flash", "MiniMax-M3", "MiniMax-M2.7"],
  ["minimax-cn", "MiniMax-M3.1-Flash", "MiniMax-M3", "MiniMax-M2.5"],
  ["opencode", "minimax-m3.1-flash-free", "minimax-m3", "minimax-m2.5"],
  ["openrouter", "minimax/minimax-m3.1-flash:free", "minimax/minimax-m3", "minimax/minimax-m2.7"],
] as const;

const catalog: {
  providers: Array<{
    id: string;
    name: string;
    models: Record<string, { id: string; capabilities?: { output: { text: boolean } } }>;
  }>;
} = {
  providers: [
    ...routes.map(([id, flash, m3, legacy]) => ({
      id,
      name: id,
      models: Object.fromEntries([legacy, m3, flash].map((modelID) => [modelID, { id: modelID }])),
    })),
    { id: "custom", name: "Custom", models: { "MiniMax-M2.7": { id: "MiniMax-M2.7" } } },
    { id: "test-provider", name: "Test", models: { "test-model": { id: "test-model" } } },
  ],
};

function catalogResponse(path: string, value = catalog): Response {
  if (state.version === "v1") return Response.json(value);
  if (path === "/api/provider") return Response.json({ data: value.providers });
  if (path === "/api/model/default") return Response.json({ data: null });
  return Response.json({
    data: value.providers.flatMap((provider) =>
      Object.values(provider.models).map((model) => ({
        id: model.id,
        enabled: true,
        time: { released: 0 },
        modelID: model.id,
        providerID: provider.id,
        name: model.id,
        capabilities: {
          input: ["text", "image"],
          output: model.capabilities?.output.text === false ? ["audio"] : ["text"],
          tools: true,
        },
        cost: [],
        variants: [],
        limit: { context: 100, output: 10 },
      })),
    ),
  });
}

beforeEach(() => {
  state.selected = undefined;
  vi.stubGlobal("fetch", state.http);
  state.http.mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input.clone() : new Request(input, init);
    expect(new URL(request.url).origin).toBe("http://opencode.test");
    if (
      request.method === "GET" &&
      ["/config/providers", "/api/provider", "/api/model", "/api/model/default"].includes(
        new URL(request.url).pathname,
      )
    ) {
      return catalogResponse(new URL(request.url).pathname);
    }
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/api/session/ses-test/prompt"
    ) {
      return Response.json("inbox-test");
    }
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/session/ses-test/prompt_async"
    ) {
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/api/session/ses-test")
      return Response.json({ data: { agent: "build" } });
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/api/session/ses-test/model"
    )
      return new Response(null, { status: 204 });
    throw new Error(`Unexpected SDK request: ${request.method} ${request.url}`);
  });
});

describe.each(["v1", "v2"] as const)(
  "MiniMax choices through the real OpenCode %s SDK",
  (version) => {
    beforeEach(() => {
      state.version = version;
    });
    it.each(routes)(
      "orders current %s choices while retaining legacy availability",
      async (providerID, flash, m3, legacy) => {
        expect((await opencodeClient.config.providers()).error).toBeUndefined();
        expect(await getProviderModels(providerID)).toEqual([
          { providerID, modelID: flash },
          { providerID, modelID: m3 },
        ]);
        expect(
          (await searchModels(`${providerID}/`)).filter((model) => model.providerID === providerID),
        ).toEqual([
          { providerID, modelID: flash },
          { providerID, modelID: m3 },
        ]);
        expect(
          (await getProviders()).find((provider) => provider.id === providerID)?.modelCount,
        ).toBe(2);
        selectModel({ providerID, modelID: legacy, variant: "high" });
        expect(await getModelAvailability(providerID, legacy)).toBe("offered");
        expect(await reconcileStoredModelSelection()).toMatchObject({
          storedModelReplaced: false,
          selectedModelListed: true,
        });
        expect(getStoredModel()).toEqual({ providerID, modelID: legacy, variant: "high" });
      },
    );

    it("preserves configured defaults, custom aliases, non-text entries and other providers", async () => {
      const response = structuredClone(catalog);
      response.providers = response.providers.filter((provider) => provider.id !== "minimax");
      response.providers.push({
        id: "minimax",
        name: "MiniMax",
        models: {
          "MiniMax-M3": { id: "MiniMax-M3" },
          "my-text-model": { id: "my-text-model" },
          "speech-02-hd": { id: "speech-02-hd" },
          "MiniMax-M2.7": { id: "MiniMax-M2.7", capabilities: { output: { text: false } } },
        },
      });
      state.http.mockImplementation(async (input) =>
        catalogResponse(
          new URL(input instanceof Request ? input.url : String(input)).pathname,
          response,
        ),
      );
      expect(await getProviderModels("custom")).toEqual([
        { providerID: "custom", modelID: "MiniMax-M2.7" },
      ]);
      expect(await getProviderModels("minimax")).toHaveLength(4);
      expect(getStoredModel()).toMatchObject({
        providerID: config.opencode.model.provider,
        modelID: config.opencode.model.modelId,
      });
      expect((await getModelSelectionLists()).favorites).toContainEqual({
        providerID: config.opencode.model.provider,
        modelID: config.opencode.model.modelId,
      });
    });

    it("retains saved legacy favorites and recent entries", async () => {
      const stateHome = path.join(process.cwd(), ".tmp", "minimax-state", version);
      vi.stubEnv("XDG_STATE_HOME", stateHome);
      await mkdir(path.join(stateHome, "opencode"), { recursive: true });
      const legacy = { providerID: "minimax", modelID: "MiniMax-M2.7" };
      const custom = { providerID: "custom", modelID: "MiniMax-M2.7" };
      await writeFile(
        path.join(stateHome, "opencode", "model.json"),
        JSON.stringify({ favorite: [legacy], recent: [custom] }),
      );
      const lists = await getModelSelectionLists();
      expect(lists.favorites).toContainEqual(legacy);
      expect(lists.recent).toContainEqual(custom);
    });

    it.each(routes)(
      "serializes picked and explicit %s IDs unchanged with files and variants",
      async (providerID, flash, m3, legacy) => {
        const choices = await getProviderModels(providerID);
        expect(choices[0]?.modelID).toBe(flash);
        for (const modelID of [flash, m3, legacy, "my-custom-model"]) {
          selectModel({ providerID, modelID, variant: "high" });
          const selection = getStoredModel();
          const file = {
            type: "file" as const,
            mime: "image/png",
            url: "data:image/png;base64,aGVsbG8=",
          };
          const options = await prepareHandedOverPrompt(
            {} as Context["api"],
            { text: "Review this file", photos: [], fileParts: [file] },
            { id: "ses-test", directory: "/project" },
            { ...selection, agent: "build" },
            {},
          );
          expect(options).not.toBeNull();
          const response = await opencodeClient.session.promptAsync(options!);
          expect(response.error).toBeUndefined();
          const [input, init] = state.http.mock.calls.at(-1)!;
          const request = input instanceof Request ? input : new Request(input, init);
          expect(await request.json()).toEqual(
            version === "v1"
              ? {
                  model: { providerID, modelID },
                  variant: "high",
                  agent: "build",
                  parts: [{ type: "text", text: "Review this file" }, file],
                }
              : {
                  text: "Review this file",
                  files: [{ uri: file.url }],
                  delivery: "queue",
                },
          );
          if (version === "v1") {
            expect(new URL(request.url).searchParams.get("directory")).toBe("/project");
          } else {
            const [modelURL, modelInit] = state.http.mock.calls.at(-2)!;
            expect(new URL(String(modelURL)).pathname).toBe("/api/session/ses-test/model");
            expect(JSON.parse(String(modelInit?.body))).toEqual({
              model: { providerID, id: modelID, variant: "high" },
            });
          }
        }
      },
    );
  },
);
