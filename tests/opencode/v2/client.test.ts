import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { isExpectedOpencodeUnavailableError } from "../../../src/utils/opencode-error.js";

const fake = vi.hoisted(() => ({
  makeOptions: null as unknown,
  events: [] as unknown[],
  client: {
    server: { info: vi.fn() },
    session: {
      get: vi.fn(),
      switchAgent: vi.fn(),
      switchModel: vi.fn(),
      prompt: vi.fn(),
      command: vi.fn(),
      wait: vi.fn(),
      active: vi.fn(),
      form: { reply: vi.fn(), cancel: vi.fn(), get: vi.fn() },
      inbox: { list: vi.fn(), cancel: vi.fn() },
    },
    message: { list: vi.fn() },
    skill: { list: vi.fn() },
    form: { list: vi.fn() },
    permission: { request: { list: vi.fn() }, reply: vi.fn() },
    event: { subscribe: vi.fn() },
  },
}));

vi.mock("@opencode/client", () => ({
  OpenCode: {
    make: (options: unknown) => {
      fake.makeOptions = options;
      return fake.client;
    },
  },
}));

import {
  createV2OpencodeClient,
  type V2ClientExtension,
} from "../../../src/opencode/v2/client.js";

const SESSION = {
  id: "ses-1",
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  title: "Session",
  agent: "build",
  model: { id: "m", providerID: "p" },
  location: { directory: "D:/repo" },
};

function createClient(): OpencodeClient {
  return createV2OpencodeClient({
    baseUrl: "http://127.0.0.1:49374",
    headers: { Authorization: "Basic abc" },
  });
}

function resetFakeClient(): void {
  const reset = (node: Record<string, unknown>) => {
    for (const value of Object.values(node)) {
      if (typeof value === "function" && "mockReset" in value) {
        (value as ReturnType<typeof vi.fn>).mockReset();
      } else if (value && typeof value === "object") {
        reset(value as Record<string, unknown>);
      }
    }
  };
  reset(fake.client as unknown as Record<string, unknown>);
  fake.client.session.get.mockResolvedValue(SESSION);
  fake.client.skill.list.mockResolvedValue({ data: [] });
}

describe("opencode/v2/client", () => {
  beforeEach(() => {
    resetFakeClient();
  });

  it("connects with the configured URL and credentials", () => {
    createClient();

    expect(fake.makeOptions).toEqual({
      baseUrl: "http://127.0.0.1:49374",
      headers: { Authorization: "Basic abc" },
    });
  });

  it("reports health with the server version", async () => {
    fake.client.server.info.mockResolvedValue({ version: "2.0.16", pid: 1, urls: [], paths: {} });

    const result = await createClient().global.health();

    expect(result).toEqual({ data: { healthy: true, version: "2.0.16" }, error: undefined });
  });

  it("returns a missing session as the V1 not-found error", async () => {
    // The shape the real client throws for a declared 404: an Error named after the body's tag.
    fake.client.session.get.mockRejectedValue(
      Object.assign(new Error("Session not found: ses-x"), {
        _tag: "SessionNotFoundError",
        name: "SessionNotFoundError",
      }),
    );

    const result = await createClient().session.get({ sessionID: "ses-x" });

    expect(result.error).toEqual({
      name: "NotFoundError",
      data: { message: "Session not found: ses-x" },
    });
  });

  it("returns an undeclared 404 as the V1 not-found error", async () => {
    fake.client.session.get.mockRejectedValue(
      Object.assign(new Error("UnexpectedStatus: 404"), {
        name: "ClientError",
        reason: "UnexpectedStatus",
        cause: { status: 404 },
      }),
    );

    const result = await createClient().session.get({ sessionID: "ses-x" });

    expect(result.error).toMatchObject({ name: "NotFoundError" });
  });

  it("leaves other unexpected statuses as they are", async () => {
    const error = Object.assign(new Error("UnexpectedStatus: 500"), {
      name: "ClientError",
      reason: "UnexpectedStatus",
      cause: { status: 500 },
    });
    fake.client.session.get.mockRejectedValue(error);

    const result = await createClient().session.get({ sessionID: "ses-x" });

    expect(result.error).toBe(error);
  });

  it("keeps a transport failure recognisable as an unavailable server", async () => {
    fake.client.server.info.mockRejectedValue(
      Object.assign(new Error("Transport: fetch failed"), { name: "ClientError" }),
    );

    const result = await createClient().global.health();

    expect(isExpectedOpencodeUnavailableError(result.error)).toBe(true);
  });

  it("switches the session model before admitting a prompt with queue delivery", async () => {
    fake.client.session.prompt.mockResolvedValue({ id: "msg-user" });

    const result = await createClient().session.promptAsync({
      sessionID: "ses-1",
      agent: "build",
      model: { providerID: "p2", modelID: "m2" },
      variant: "high",
      parts: [
        { type: "text", text: "Look" },
        { type: "file", mime: "image/png", filename: "a.png", url: "data:image/png;base64,AAA" },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(fake.client.session.switchAgent).not.toHaveBeenCalled();
    expect(fake.client.session.switchModel).toHaveBeenCalledWith({
      sessionID: "ses-1",
      model: { providerID: "p2", id: "m2", variant: "high" },
    });
    expect(fake.client.session.prompt).toHaveBeenCalledWith({
      sessionID: "ses-1",
      text: "Look",
      files: [{ uri: "data:image/png;base64,AAA", name: "a.png" }],
      delivery: "queue",
    });
  });

  it("sends a prompt with the requested delivery and returns the inbox id it waits under", async () => {
    fake.client.session.prompt.mockResolvedValue({ id: "msg-inbox-1" });
    const client = createClient() as unknown as V2ClientExtension;

    const result = await client.session.promptAsync({
      sessionID: "ses-1",
      parts: [{ type: "text", text: "Also check the tests" }],
      delivery: "steer",
    });

    expect(result).toEqual({ data: { inboxID: "msg-inbox-1" }, error: undefined });
    expect(fake.client.session.prompt).toHaveBeenCalledWith({
      sessionID: "ses-1",
      text: "Also check the tests",
      delivery: "steer",
    });
  });

  it("lists the ids still waiting in the session inbox", async () => {
    fake.client.session.inbox.list.mockResolvedValue([
      { id: "msg-a", type: "user", delivery: "steer" },
      { id: "msg-b", type: "user", delivery: "queue" },
    ]);
    const client = createClient() as unknown as V2ClientExtension;

    const result = await client.session.inbox.list({ sessionID: "ses-1" });

    expect(result.data).toEqual(["msg-a", "msg-b"]);
    expect(fake.client.session.inbox.list).toHaveBeenCalledWith({ sessionID: "ses-1" });
  });

  it("cancels a waiting inbox message", async () => {
    fake.client.session.inbox.cancel.mockResolvedValue(undefined);
    const client = createClient() as unknown as V2ClientExtension;

    const result = await client.session.inbox.cancel({ sessionID: "ses-1", inboxID: "msg-a" });

    expect(result).toEqual({ data: true, error: undefined });
    expect(fake.client.session.inbox.cancel).toHaveBeenCalledWith({
      sessionID: "ses-1",
      inboxID: "msg-a",
    });
  });

  it("reports a refused admission as the call's error", async () => {
    fake.client.session.command.mockRejectedValue(
      Object.assign(new Error("Command not found: nope"), { name: "CommandNotFoundError" }),
    );

    const result = await createClient().session.command({
      sessionID: "ses-1",
      command: "nope",
      arguments: "",
    });

    expect(result.error).toBeDefined();
  });

  it("waits for the run and returns the model reply to a blocking prompt", async () => {
    fake.client.session.prompt.mockResolvedValue({ id: "msg-user" });
    fake.client.session.wait.mockResolvedValue(undefined);
    fake.client.message.list.mockResolvedValue({
      data: [
        { id: "msg-idle", type: "idle", time: { created: 4 } },
        {
          id: "msg-a",
          type: "assistant",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: 2, completed: 3 },
          content: [{ type: "text", text: '{"kind":"once"}' }],
        },
        { id: "msg-user", type: "user", text: "parse", time: { created: 1 } },
      ],
      cursor: {},
    });

    const result = await createClient().session.prompt({
      sessionID: "ses-1",
      system: "You are a parser.",
      parts: [{ type: "text", text: "every day" }],
    });

    expect(fake.client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: "You are a parser.\n\nevery day" }),
    );
    expect(fake.client.session.wait).toHaveBeenCalledWith({ sessionID: "ses-1" });
    expect(result.data?.info.id).toBe("msg-a");
    expect(result.data?.parts).toEqual([
      expect.objectContaining({ type: "text", text: '{"kind":"once"}' }),
    ]);
  });

  it("runs a skill through a prompt and other commands through the command endpoint", async () => {
    fake.client.skill.list.mockResolvedValue({ data: [{ id: "review", name: "Review" }] });
    const client = createClient();

    await client.session.command({ sessionID: "ses-1", command: "review", arguments: "branch" });
    await client.session.command({ sessionID: "ses-1", command: "init", arguments: "" });

    expect(fake.client.session.prompt).toHaveBeenCalledWith({
      sessionID: "ses-1",
      text: "branch",
      skills: [{ id: "review" }],
      delivery: "queue",
    });
    expect(fake.client.session.command).toHaveBeenCalledWith({
      sessionID: "ses-1",
      name: "init",
      text: "",
      delivery: "queue",
    });
  });

  it("lists pending forms by directory and answers them per session", async () => {
    fake.client.form.list.mockResolvedValue({
      data: [
        {
          id: "form-1",
          sessionID: "ses-1",
          title: "Go?",
          fields: [{ key: "go", type: "boolean", title: "Go?" }],
        },
      ],
    });
    const client = createClient();

    const listed = await client.question.list({ directory: "D:/repo" });
    await client.question.reply({ requestID: "form-1", answers: [["true"]] });

    expect(fake.client.form.list).toHaveBeenCalledWith({ location: { directory: "D:/repo" } });
    expect(listed.data?.[0]).toMatchObject({ id: "form-1", sessionID: "ses-1" });
    expect(fake.client.session.form.reply).toHaveBeenCalledWith({
      sessionID: "ses-1",
      formID: "form-1",
      answer: { go: true },
    });
  });

  it("answers a listed permission in its own session", async () => {
    fake.client.permission.request.list.mockResolvedValue({
      data: [{ id: "perm-1", sessionID: "ses-2", action: "edit", resources: ["a.ts"] }],
    });
    const client = createClient();

    await client.permission.list({ directory: "D:/repo" });
    const result = await client.permission.reply({ requestID: "perm-1", reply: "reject" });

    expect(result.error).toBeUndefined();
    expect(fake.client.permission.reply).toHaveBeenCalledWith({
      sessionID: "ses-2",
      requestID: "perm-1",
      decision: "reject",
    });
  });

  it("maps active sessions into the V1 busy status map", async () => {
    fake.client.session.active.mockResolvedValue({ "ses-1": { type: "running" } });

    const result = await createClient().session.status({ directory: "D:/repo" });

    expect(result.data).toEqual({ "ses-1": { type: "busy" } });
  });

  it("serves the translated stream on both event entry points", async () => {
    fake.client.event.subscribe.mockImplementation(() =>
      (async function* () {
        yield { id: "evt-1", type: "server.connected", data: {} };
        yield {
          id: "evt-2",
          type: "session.execution.started",
          data: { sessionID: "ses-1" },
          location: { directory: "D:/repo" },
        };
      })(),
    );
    const client = createClient() as unknown as {
      global: {
        event: () => Promise<{
          stream: AsyncIterable<{ directory?: string; payload: { type: string } }>;
        }>;
      };
      event: { subscribe: () => Promise<{ stream: AsyncIterable<{ type: string }> }> };
    };

    const globalEvents = [];
    for await (const envelope of (await client.global.event()).stream) {
      globalEvents.push(envelope);
    }
    const projectEvents = [];
    for await (const item of (await client.event.subscribe()).stream) {
      projectEvents.push(item.type);
    }

    expect(globalEvents.map((envelope) => envelope.payload.type)).toEqual([
      "server.connected",
      "session.status",
    ]);
    expect(globalEvents[1]?.directory).toBe("D:/repo");
    expect(projectEvents).toEqual(["server.connected", "session.status"]);
  });
});
