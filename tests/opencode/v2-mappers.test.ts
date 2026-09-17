import { describe, expect, it } from "vitest";
import type { FormInfo, ModelInfo } from "@opencode/client";
import { mapFormAnswers, mapModel, mapTool } from "../../src/opencode/v2-mappers.js";

describe("V2 data mappings", () => {
  it("preserves native media capabilities and variants for the model picker", () => {
    const model: ModelInfo = {
      id: "model",
      modelID: "provider-model",
      providerID: "provider",
      name: "Model",
      capabilities: { tools: true, input: ["text", "image", "pdf"], output: ["text"] },
      variants: [{ id: "high", settings: { effort: "high" } }],
      time: { released: 0 },
      cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0 } }],
      status: "active",
      enabled: true,
      limit: { context: 100000, output: 20000 },
    };
    expect(mapModel(model)).toMatchObject({
      id: "model",
      capabilities: { toolcall: true, input: { text: true, image: true, pdf: true, audio: false } },
      variants: { high: { effort: "high" } },
      cost: { input: 1, output: 2, cache: { read: 0.1, write: 0 } },
    });
  });

  it("maps subagent tool arguments to the existing subagent card contract", () => {
    expect(
      mapTool(
        {
          type: "tool",
          id: "tool_test",
          name: "subagent",
          time: { created: 100, ran: 120 },
          state: {
            status: "running",
            input: { agent: "explore", description: "Inspect files", prompt: "Find configuration" },
            metadata: {},
          },
        },
        "ses_test",
        "msg_test",
      ),
    ).toMatchObject({
      tool: "task",
      state: {
        input: {
          subagent_type: "explore",
          description: "Inspect files",
          prompt: "Find configuration",
        },
        time: { start: 120 },
      },
    });
  });

  it("converts typed form answers and omits fields whose conditions are false", () => {
    const form: FormInfo = {
      id: "form_test",
      sessionID: "ses_test",
      title: "Settings",
      fields: [
        { key: "enabled", type: "boolean" },
        { key: "count", type: "integer" },
        {
          key: "tags",
          type: "multiselect",
          options: [
            { label: "First", value: "one" },
            { label: "Second", value: "two" },
          ],
        },
        { key: "detail", type: "string", when: [{ key: "enabled", op: "eq", value: true }] },
      ],
    };
    expect(mapFormAnswers(form, [["false"], ["3"], ["First", "Second"], ["ignored"]])).toEqual({
      enabled: false,
      count: 3,
      tags: ["one", "two"],
    });
    expect(() => mapFormAnswers(form, [["false"], ["not a number"]])).toThrow(
      "Invalid numeric answer",
    );
  });
});
