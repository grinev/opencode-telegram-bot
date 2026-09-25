import { describe, expect, it } from "vitest";
import type { FormInfo, ModelInfo, SessionMessageInfo } from "@opencode/client";
import {
  toFormAnswer,
  toV1Message,
  toV1Providers,
  toV1Question,
  toV1ToolInput,
  toV1ToolName,
  toV2PromptInput,
} from "../../../src/opencode/v2/mappers.js";

function createForm(fields: FormInfo["fields"]): FormInfo {
  return { id: "form-1", sessionID: "ses-1", title: "Pick one", fields };
}

describe("opencode/v2/mappers", () => {
  it("names V2 tools the way the bot's formatters know them", () => {
    expect(toV1ToolName("shell")).toBe("bash");
    expect(toV1ToolName("subagent")).toBe("task");
    expect(toV1ToolName("patch")).toBe("apply_patch");
    expect(toV1ToolName("read")).toBe("read");
  });

  it("adds the V1 input fields while keeping the V2 ones", () => {
    expect(toV1ToolInput("read", { path: "a.txt" })).toEqual({ path: "a.txt", filePath: "a.txt" });
    expect(toV1ToolInput("task", { agent: "explore", prompt: "look" })).toMatchObject({
      subagent_type: "explore",
    });
    expect(toV1ToolInput("apply_patch", { patch: "*** Begin Patch" })).toMatchObject({
      patchText: "*** Begin Patch",
    });
  });

  it("maps every visible form field into the question UI", () => {
    const form = createForm([
      {
        key: "color",
        type: "string",
        title: "Color",
        options: [
          { value: "r", label: "Red" },
          { value: "g", label: "Green" },
        ],
      },
      { key: "tags", type: "multiselect", title: "Tags", options: [{ value: "a", label: "A" }] },
      { key: "ok", type: "boolean", title: "Proceed?" },
      { key: "count", type: "integer", title: "How many?" },
      { key: "login", type: "external", url: "https://example.com/auth", title: "Sign in" },
      { key: "secret", type: "string", title: "Hidden", hidden: true },
      {
        key: "extra",
        type: "string",
        title: "Extra",
        when: [{ key: "ok", op: "eq", value: true }],
      },
    ]);

    const request = toV1Question(form);

    expect(request).toMatchObject({ id: "form-1", sessionID: "ses-1" });
    expect(request.questions.map((question) => question.header)).toEqual([
      "Color",
      "Tags",
      "Proceed?",
      "How many?",
      "Sign in",
    ]);
    expect(request.questions[0]?.options.map((option) => option.label)).toEqual(["Red", "Green"]);
    expect(request.questions[1]?.multiple).toBe(true);
    expect(request.questions[2]?.options.map((option) => option.label)).toEqual(["true", "false"]);
    expect(request.questions[3]?.options).toEqual([]);
    expect(request.questions[4]?.question).toContain("https://example.com/auth");
  });

  it("converts the chosen labels and typed answers back into form values", () => {
    const form = createForm([
      {
        key: "color",
        type: "string",
        options: [
          { value: "r", label: "Red" },
          { value: "g", label: "Green" },
        ],
      },
      { key: "tags", type: "multiselect", options: [{ value: "a", label: "A" }] },
      { key: "ok", type: "boolean" },
      { key: "count", type: "integer" },
      { key: "note", type: "string" },
      { key: "login", type: "external", url: "https://example.com/auth" },
    ]);

    expect(
      toFormAnswer(form, [["Green"], ["A", "custom"], ["false"], [" 3 "], ["hello"], ["done"]]),
    ).toEqual({
      color: "g",
      tags: ["a", "custom"],
      ok: false,
      count: 3,
      note: "hello",
    });
  });

  it("refuses a typed answer that is not a number", () => {
    const form = createForm([{ key: "count", type: "integer" }]);

    expect(() => toFormAnswer(form, [["three"]])).toThrow(/not a valid integer/);
  });

  it("splits prompt parts into V2 text and inline file attachments", () => {
    expect(
      toV2PromptInput([
        { type: "text", text: "Look at this" },
        { type: "file", mime: "image/png", filename: "shot.png", url: "data:image/png;base64,AAA" },
      ]),
    ).toEqual({
      text: "Look at this",
      files: [{ uri: "data:image/png;base64,AAA", name: "shot.png" }],
    });
  });

  it("maps assistant messages into V1 messages with parts", () => {
    const message = {
      id: "msg-1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: 1, completed: 5 },
      tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.5,
      content: [
        { type: "reasoning", text: "thinking" },
        {
          type: "tool",
          id: "call-1",
          name: "shell",
          state: {
            status: "completed",
            input: { command: "echo hi" },
            content: [{ type: "text", text: "hi" }],
          },
          time: { created: 2, ran: 3, completed: 4 },
        },
        { type: "text", text: "DONE" },
      ],
    } as unknown as SessionMessageInfo;

    const mapped = toV1Message(message, "ses-1", "D:/repo");

    expect(mapped?.info).toMatchObject({
      id: "msg-1",
      role: "assistant",
      agent: "build",
      providerID: "p",
      modelID: "m",
      time: { created: 1, completed: 5 },
      cost: 0.5,
    });
    expect(mapped?.parts.map((part) => part.type)).toEqual(["reasoning", "tool", "text"]);
    expect(mapped?.parts[1]).toMatchObject({
      tool: "bash",
      callID: "call-1",
      state: { status: "completed", output: "hi", input: { command: "echo hi" } },
    });
  });

  it("drops V2 message kinds that have no V1 form", () => {
    const idle = {
      id: "msg-2",
      type: "idle",
      time: { created: 1 },
    } as unknown as SessionMessageInfo;

    expect(toV1Message(idle, "ses-1", "D:/repo")).toBeNull();
  });

  it("folds enabled V2 models into the V1 providers catalog", () => {
    const model = {
      id: "gpt",
      modelID: "gpt-upstream",
      providerID: "openai",
      name: "GPT",
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      variants: [{ id: "low" }, { id: "high" }],
      time: { released: 0 },
      cost: [],
      status: "active",
      enabled: true,
      limit: { context: 1000, output: 100 },
    } as unknown as ModelInfo;
    const disabled = { ...model, id: "old", enabled: false } as ModelInfo;

    const providers = toV1Providers([{ id: "openai", name: "OpenAI" }], [model, disabled]);

    expect(providers).toHaveLength(1);
    expect(providers[0]?.name).toBe("OpenAI");
    expect(Object.keys(providers[0]?.models ?? {})).toEqual(["gpt"]);
    expect(providers[0]?.models.gpt?.limit.context).toBe(1000);
    expect(Object.keys(providers[0]?.models.gpt?.variants ?? {})).toEqual(["low", "high"]);
    expect(providers[0]?.models.gpt?.capabilities.input.image).toBe(true);
  });
});
