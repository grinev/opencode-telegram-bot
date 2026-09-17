import { describe, expect, it, vi } from "vitest";
import { OpenCode, type V2Event } from "@opencode/client";
import { createV2EventMapper } from "../../src/opencode/v2-events.js";
import { emptyTokens } from "../../src/opencode/v2-mappers.js";

function event<T extends V2Event["type"]>(
  type: T,
  data: Extract<V2Event, { type: T }>["data"],
  created = 100,
): Extract<V2Event, { type: T }> {
  return {
    id: `evt_${created}`,
    type,
    data,
    created,
    location: { directory: "/workspace" },
    durable: { aggregateID: "ses_test", seq: created, version: 1 },
  } as Extract<V2Event, { type: T }>;
}
const base = { sessionID: "ses_test", assistantMessageID: "msg_test" };
const model = { id: "model", providerID: "provider" };

describe("OpenCode V2 event conversion", () => {
  it("streams reasoning, text and tools with stable part IDs and final completion ordering", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/message/msg_test"))
        return Response.json({
          data: {
            id: "msg_test",
            type: "assistant",
            agent: "build",
            model,
            time: { created: 100, completed: 300 },
            tokens: { ...emptyTokens(), output: 10 },
            cost: 0.01,
            finish: "stop",
            content: [
              { type: "reasoning", text: "Think" },
              { type: "text", text: "Hello world" },
            ],
          },
        });
      return Response.json({ data: { id: "ses_test", location: { directory: "/workspace" } } });
    });
    const convert = createV2EventMapper(OpenCode.make({ baseUrl: "http://opencode.test", fetch }));
    await convert(event("session.step.started", { ...base, agent: "build", model }));
    await convert(event("session.reasoning.started", { ...base, ordinal: 0 }));
    await convert(event("session.reasoning.delta", { ...base, ordinal: 0, delta: "Think" }));
    await convert(event("session.text.started", { ...base, ordinal: 1 }));
    await convert(event("session.text.delta", { ...base, ordinal: 1, delta: "Hello " }));
    const incremental = await convert(
      event("session.text.delta", { ...base, ordinal: 1, delta: "world" }),
    );
    expect(incremental).toContainEqual(
      expect.objectContaining({
        type: "message.part.updated",
        properties: expect.objectContaining({
          part: expect.objectContaining({ id: "msg_test:1", text: "Hello world" }),
        }),
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
    const completed = await convert(
      event(
        "session.step.ended",
        { ...base, finish: "stop", cost: 0.01, tokens: { ...emptyTokens(), output: 10 } },
        300,
      ),
    );
    expect(completed.at(-1)).toMatchObject({
      type: "message.updated",
      properties: {
        info: {
          role: "assistant",
          finish: "stop",
          time: { completed: 300 },
          tokens: { output: 10 },
        },
      },
    });
    expect(completed[1]).toMatchObject({
      type: "message.part.updated",
      properties: { part: { id: "msg_test:1", text: "Hello world" } },
    });
  });

  it("maps running and finished tools, retaining their input and duration", async () => {
    const convert = createV2EventMapper(OpenCode.make({ baseUrl: "http://opencode.test" }));
    await convert(event("session.step.started", { ...base, agent: "build", model }));
    await convert(event("session.tool.input.started", { ...base, id: "tool_test", name: "shell" }));
    const running = await convert(
      event(
        "session.tool.called",
        { ...base, id: "tool_test", input: { command: "npm test" }, executed: true },
        120,
      ),
    );
    expect(running.at(-1)).toMatchObject({
      properties: { part: { tool: "bash", state: { status: "running", time: { start: 120 } } } },
    });
    const completed = await convert(
      event(
        "session.tool.success",
        {
          ...base,
          id: "tool_test",
          content: [{ type: "text", text: "Tests passed" }],
          executed: true,
        },
        220,
      ),
    );
    expect(completed.at(-1)).toMatchObject({
      properties: {
        part: {
          id: "tool_test",
          state: {
            status: "completed",
            input: { command: "npm test" },
            output: "Tests passed",
            time: { start: 120, end: 220 },
          },
        },
      },
    });
  });

  it("recovers mid-step subscriptions from snapshots without appending already projected deltas", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/message/"))
        return Response.json({
          data: {
            id: "msg_test",
            type: "assistant",
            agent: "build",
            model,
            time: { created: 100 },
            content: [{ type: "text", text: "Already includes this delta" }],
          },
        });
      return Response.json({ data: { id: "ses_test", location: { directory: "/workspace" } } });
    });
    const convert = createV2EventMapper(OpenCode.make({ baseUrl: "http://opencode.test", fetch }));
    const recovered = await convert(
      event("session.text.delta", { ...base, ordinal: 0, delta: "delta" }),
    );
    expect(recovered[1]).toMatchObject({
      properties: { part: { text: "Already includes this delta" } },
    });
    const calls = fetch.mock.calls.length;
    expect(
      await convert(event("session.text.delta", { ...base, ordinal: 0, delta: "delta" })),
    ).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it("maps form lifecycle and permissions to the existing interactive flows", async () => {
    const convert = createV2EventMapper(OpenCode.make({ baseUrl: "http://opencode.test" }));
    const question = await convert(
      event("form.created", {
        form: {
          id: "form_test",
          sessionID: "ses_test",
          title: "Choose",
          fields: [
            { key: "choice", type: "multiselect", options: [{ value: "one", label: "One" }] },
          ],
        },
      }),
    );
    expect(question[0]).toMatchObject({
      type: "question.asked",
      properties: { id: "form_test", questions: [{ multiple: true }] },
    });
    expect(
      await convert(event("form.cancelled", { id: "form_test", sessionID: "ses_test" })),
    ).toEqual([
      { type: "question.rejected", properties: { requestID: "form_test", sessionID: "ses_test" } },
    ]);
    expect(
      await convert(
        event("permission.asked", {
          id: "perm_test",
          sessionID: "ses_test",
          action: "shell",
          resources: ["npm test"],
        }),
      ),
    ).toMatchObject([
      { type: "permission.asked", properties: { permission: "bash", patterns: ["npm test"] } },
    ]);
  });

  it("reports native execution lifecycle so the bot becomes idle after completion", async () => {
    const convert = createV2EventMapper(OpenCode.make({ baseUrl: "http://opencode.test" }));
    expect(
      await convert(event("session.execution.started", { sessionID: "ses_test" })),
    ).toMatchObject([{ type: "session.status", properties: { status: { type: "busy" } } }]);
    expect(
      await convert(event("session.execution.succeeded", { sessionID: "ses_test" })),
    ).toMatchObject([
      { type: "session.status", properties: { status: { type: "idle" } } },
      { type: "session.idle", properties: { sessionID: "ses_test" } },
    ]);
  });
});
