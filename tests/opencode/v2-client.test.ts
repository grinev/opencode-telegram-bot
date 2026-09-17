import { describe, expect, it, vi } from "vitest";
import { createV2Client } from "../../src/opencode/v2-client.js";
import { emptyTokens } from "../../src/opencode/v2-mappers.js";

const session = {
  id: "ses_test",
  projectID: "project",
  title: "Test session",
  location: { directory: "/workspace" },
  agent: "build",
  model: { id: "model", providerID: "provider" },
  cost: 0,
  tokens: emptyTokens(),
  time: { created: 100, updated: 200 },
};
const assistant = {
  id: "msg_assistant",
  type: "assistant",
  agent: "build",
  model: session.model,
  time: { created: 200, completed: 300 },
  finish: "stop",
  tokens: emptyTokens(),
  content: [{ type: "text", text: "Completed" }],
};

function setup(
  handler: (
    path: string,
    method: string,
    body: Record<string, unknown>,
    request: Request,
  ) => unknown | Response,
) {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    const output = handler(
      new URL(request.url).pathname,
      request.method,
      text ? JSON.parse(text) : {},
      request,
    );
    if (output instanceof Response) return output;
    if (output === undefined) return new Response(null, { status: 204 });
    return Response.json(output);
  });
  return { client: createV2Client({ baseUrl: "http://opencode.test", fetch }), fetch };
}

describe("OpenCode V2 transport", () => {
  it("waits for queued compaction before reporting success", async () => {
    const paths: string[] = [];
    const { client } = setup((path) => {
      paths.push(path);
      if (path.endsWith("/compact")) return { data: {} };
    });
    expect(
      await client.session.summarize({
        sessionID: "ses_test",
        providerID: "provider",
        modelID: "model",
      }),
    ).toEqual({ data: true });
    expect(paths).toEqual([
      "/api/session/ses_test/model",
      "/api/session/ses_test/compact",
      "/api/experimental/session/ses_test/wait",
    ]);
  });
  it("uses server info and only falls back to the 2.0.4 status route on 404", async () => {
    const { client, fetch } = setup((path) => {
      if (path === "/api/info") return new Response(null, { status: 404 });
      expect(path).toBe("/api/status");
      return { version: "2.0.4", pid: 1, urls: [] };
    });
    expect(await client.global.health()).toMatchObject({
      data: { healthy: true, version: "2.0.4" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves authentication and cancellation without masking authorization errors", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.headers.get("authorization")).toBe("Basic test");
      expect(request.signal.aborted).toBe(false);
      return new Response(null, { status: 401 });
    });
    const client = createV2Client({
      baseUrl: "http://opencode.test",
      headers: { Authorization: "Basic test" },
      fetch,
    });
    expect((await client.global.health({ signal: controller.signal })).error).toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("starts prompts through the V2 inbox with selected settings and native file URIs", async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const { client } = setup((path, _method, body) => {
      calls.push({ path, body });
      if (path.endsWith("/prompt"))
        return {
          data: { id: "msg_user", sessionID: "ses_test", type: "user", payload: { text: "Hello" } },
        };
    });
    const response = await client.session.promptAsync({
      sessionID: "ses_test",
      directory: "/workspace",
      agent: "review",
      model: { providerID: "provider", modelID: "model" },
      variant: "high",
      parts: [
        { type: "text", text: "Hello" },
        {
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,aGVsbG8=",
          filename: "image.png",
        },
      ],
    });
    expect(response.error).toBeUndefined();
    expect(calls).toEqual([
      { path: "/api/session/ses_test/agent", body: { agent: "review" } },
      {
        path: "/api/session/ses_test/model",
        body: { model: { id: "model", providerID: "provider", variant: "high" } },
      },
      {
        path: "/api/session/ses_test/prompt",
        body: {
          text: "Hello",
          files: [{ uri: "data:image/png;base64,aGVsbG8=", name: "image.png" }],
        },
      },
    ]);
  });

  it("waits for synchronous prompts and returns the completed assistant response", async () => {
    const paths: string[] = [];
    const { client } = setup((path) => {
      paths.push(path);
      if (path.endsWith("/prompt")) return { data: {} };
      if (path.endsWith("/wait")) return undefined;
      if (path.endsWith("/message")) return { data: [assistant], cursor: {} };
      if (path === "/api/session/ses_test") return { data: session };
      throw new Error(`Unexpected request: ${path}`);
    });
    const response = await client.session.prompt({
      sessionID: "ses_test",
      parts: [{ type: "text", text: "Hello" }],
    });
    expect(response.error).toBeUndefined();
    expect(response.data).toMatchObject({
      info: { role: "assistant", modelID: "model" },
      parts: [{ type: "text", text: "Completed" }],
    });
    expect(paths.indexOf("/api/experimental/session/ses_test/wait")).toBeGreaterThan(
      paths.indexOf("/api/session/ses_test/prompt"),
    );
  });

  it("unwraps paginated sessions and maps location to the bot directory", async () => {
    const { client } = setup((path, _method, _body, request) => {
      expect(path).toBe("/api/session");
      const cursor = new URL(request.url).searchParams.get("cursor");
      if (cursor) expect(new URL(request.url).searchParams.has("order")).toBe(false);
      return {
        data: [cursor ? { ...session, id: "ses_second" } : session],
        cursor: cursor ? {} : { next: "next-page" },
      };
    });
    const response = await client.session.list();
    expect(response.data?.map((item) => ({ id: item.id, directory: item.directory }))).toEqual([
      { id: "ses_test", directory: "/workspace" },
      { id: "ses_second", directory: "/workspace" },
    ]);
  });

  it("paginates history and returns user/assistant messages in chronological order", async () => {
    const user = { id: "msg_user", type: "user", text: "Hello", time: { created: 100 } };
    const { client } = setup((path, _method, _body, request) => {
      if (path === "/api/session/ses_test") return { data: session };
      const cursor = new URL(request.url).searchParams.get("cursor");
      if (cursor) expect(new URL(request.url).searchParams.has("order")).toBe(false);
      return { data: cursor ? [user] : [assistant], cursor: cursor ? {} : { next: "next-page" } };
    });
    const response = await client.session.messages({ sessionID: "ses_test" });
    expect(response.data?.map((item) => item.info.role)).toEqual(["user", "assistant"]);
    expect(response.data?.[0]?.parts[0]).toMatchObject({ text: "Hello" });
  });

  it("maps pending forms and replies using field keys and option values", async () => {
    const form = {
      id: "form_test",
      sessionID: "ses_test",
      title: "Choose",
      fields: [
        { key: "language", type: "string", options: [{ label: "English", value: "en" }] },
        { key: "count", type: "integer" },
      ],
    };
    const { client } = setup((path, _method, body) => {
      if (path === "/api/form") return { location: session.location, data: [form] };
      expect(path).toBe("/api/session/ses_test/form/form_test/reply");
      expect(body).toEqual({ answer: { language: "en", count: 3 } });
    });
    expect((await client.question.list()).data?.[0]).toMatchObject({
      id: "form_test",
      questions: [{ options: [{ label: "English" }] }, { custom: true }],
    });
    expect(
      await client.question.reply({ requestID: "form_test", answers: [["English"], ["3"]] }),
    ).toEqual({ data: true });
  });

  it("resolves permission requests to their session and sends a V2 decision", async () => {
    const { client } = setup((path, _method, body) => {
      if (path === "/api/permission/request")
        return {
          location: session.location,
          data: [
            {
              id: "permission_test",
              sessionID: "ses_test",
              action: "shell",
              resources: ["npm test"],
            },
          ],
        };
      expect(path).toBe("/api/session/ses_test/permission/permission_test/reply");
      expect(body).toEqual({ decision: "once" });
    });
    expect((await client.permission.list()).data?.[0]).toMatchObject({
      permission: "bash",
      patterns: ["npm test"],
    });
    expect(await client.permission.reply({ requestID: "permission_test", reply: "once" })).toEqual({
      data: true,
    });
  });

  it("uses interrupt and stages a revert at the selected user message", async () => {
    const { client } = setup((path, _method, body) => {
      if (path.endsWith("/interrupt")) return { data: { interrupted: false } };
      if (path.endsWith("/revert/stage")) {
        expect(body).toEqual({ messageID: "msg_user", files: true });
        return { data: { messageID: "msg_user" } };
      }
      return { data: { ...session, revert: { messageID: "msg_user" } } };
    });
    expect(await client.session.abort({ sessionID: "ses_test" })).toEqual({ data: true });
    expect(
      (await client.session.revert({ sessionID: "ses_test", messageID: "msg_user" })).data?.revert
        ?.messageID,
    ).toBe("msg_user");
  });
});
