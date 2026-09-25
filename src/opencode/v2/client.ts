import type { Event, FilePartInput, OpencodeClient, TextPartInput } from "@opencode-ai/sdk/v2";
import { OpenCode, type FormInfo, type OpenCodeClient } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { createV2EventTranslator, type V1GlobalEvent } from "./events.js";
import {
  toFormAnswer,
  toV1Agent,
  toV1Commands,
  toV1FileDiff,
  toV1GlobalSession,
  toV1McpStatus,
  toV1Message,
  toV1Permission,
  toV1Project,
  toV1Providers,
  toV1Question,
  toV1Session,
  toV2PromptInput,
  type V1MessageWithParts,
} from "./mappers.js";

type Result<T> = { data: T; error: undefined } | { data: undefined; error: unknown };

interface V2ClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
}

interface PromptParams {
  sessionID: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  parts: Array<TextPartInput | FilePartInput>;
}

interface CommandParams {
  sessionID: string;
  command: string;
  arguments?: string;
  agent?: string;
  model?: string;
  variant?: string;
}

const HEARTBEAT_INTERVAL_MS = 10_000;
const MESSAGE_PAGE_SIZE = 200;
const MAX_MESSAGE_PAGES = 50;
const COMPLETION_POLL_INTERVAL_MS = 250;
const COMPLETION_POLL_ATTEMPTS = 40;

function isNotFound(error: Error): boolean {
  // Declared answers are named after their tag (SessionNotFoundError, ...); an undeclared
  // 404 arrives as a ClientError carrying the status.
  if (error.name.endsWith("NotFoundError")) {
    return true;
  }
  const { reason, cause } = error as Error & { reason?: unknown; cause?: unknown };
  return (
    error.name === "ClientError" &&
    reason === "UnexpectedStatus" &&
    (cause as { status?: unknown } | undefined)?.status === 404
  );
}

/** Reports V2 "not found" answers in the V1 error shape the bot already recognises. */
function toV1Error(error: unknown): unknown {
  if (error instanceof Error && isNotFound(error)) {
    return { name: "NotFoundError", data: { message: error.message } };
  }
  return error;
}

async function run<T>(operation: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await operation(), error: undefined };
  } catch (error) {
    return { data: undefined, error: toV1Error(error) };
  }
}

function location(directory: string | undefined) {
  return directory ? { location: { directory } } : {};
}

function parseModelRef(model: string | undefined): { providerID: string; id: string } | undefined {
  if (!model) {
    return undefined;
  }
  const separator = model.indexOf("/");
  if (separator <= 0) {
    return undefined;
  }
  return { providerID: model.slice(0, separator), id: model.slice(separator + 1) };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The OpenCode V2 server behind the client surface the bot already speaks: the methods the
 * bot calls, with V1 request and result shapes, and the V2 event stream translated into V1
 * events. Only that surface is implemented; everything else is absent.
 */
export function createV2OpencodeClient(options: V2ClientOptions): OpencodeClient {
  const client: OpenCodeClient = OpenCode.make({
    baseUrl: options.baseUrl,
    ...(options.headers ? { headers: options.headers } : {}),
  });

  // Replies to V2 forms and permissions need the session and, for forms, the fields;
  // both are learned from the lists and the event stream.
  const forms = new Map<string, FormInfo>();
  const permissionSessions = new Map<string, string>();

  const rememberForm = (form: FormInfo) => {
    forms.set(form.id, form);
  };

  async function applySelection(
    sessionID: string,
    agent: string | undefined,
    model: { providerID: string; id: string } | undefined,
    variant: string | undefined,
  ): Promise<void> {
    if (!agent && !model) {
      return;
    }
    const session = await client.session.get({ sessionID });
    if (agent && session.agent !== agent) {
      await client.session.switchAgent({ sessionID, agent });
    }
    if (
      model &&
      (session.model?.id !== model.id ||
        session.model.providerID !== model.providerID ||
        (variant !== undefined && session.model.variant !== variant))
    ) {
      await client.session.switchModel({
        sessionID,
        model: { ...model, ...(variant ? { variant } : {}) },
      });
    }
  }

  async function admitPrompt(params: PromptParams) {
    await applySelection(
      params.sessionID,
      params.agent,
      params.model ? { providerID: params.model.providerID, id: params.model.modelID } : undefined,
      params.variant,
    );
    const { text, files } = toV2PromptInput(params.parts);
    return client.session.prompt({
      sessionID: params.sessionID,
      text: params.system ? `${params.system}\n\n${text}` : text,
      ...(files.length > 0 ? { files } : {}),
      delivery: "queue",
    });
  }

  async function listMessages(sessionID: string, limit?: number) {
    if (limit !== undefined) {
      // Other entry kinds (idle markers, model switches) share the page, so over-fetch.
      const page = await client.message.list({ sessionID, limit: limit * 3, order: "desc" });
      return [...page.data].reverse();
    }
    const all = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
      // A cursor carries its own order; the server refuses both together.
      const result = await client.message.list({
        sessionID,
        limit: MESSAGE_PAGE_SIZE,
        ...(cursor ? { cursor } : { order: "asc" }),
      });
      all.push(...result.data);
      const next = result.cursor.next;
      if (!next || result.data.length === 0) {
        break;
      }
      cursor = next;
    }
    return all;
  }

  async function sessionMessages(sessionID: string, limit?: number): Promise<V1MessageWithParts[]> {
    const [session, messages] = await Promise.all([
      client.session.get({ sessionID }),
      listMessages(sessionID, limit),
    ]);
    const mapped = messages
      .map((message) => toV1Message(message, sessionID, session.location.directory))
      .filter((message): message is V1MessageWithParts => message !== null);
    return limit !== undefined ? mapped.slice(-limit) : mapped;
  }

  async function lastAssistantMessage(sessionID: string): Promise<V1MessageWithParts> {
    for (let attempt = 0; attempt < COMPLETION_POLL_ATTEMPTS; attempt++) {
      const messages = await sessionMessages(sessionID, 10);
      const last = [...messages].reverse().find((message) => message.info.role === "assistant");
      if (last && last.info.role === "assistant" && last.info.time.completed) {
        return last;
      }
      await delay(COMPLETION_POLL_INTERVAL_MS);
    }
    throw new Error(`No completed assistant reply in session ${sessionID}`);
  }

  async function runCommand(params: CommandParams): Promise<void> {
    await applySelection(
      params.sessionID,
      params.agent,
      parseModelRef(params.model),
      params.variant,
    );
    const skills = await client.skill.list();
    const text = params.arguments ?? "";
    if (skills.data.some((skill) => skill.id === params.command)) {
      await client.session.prompt({
        sessionID: params.sessionID,
        text: text || `/${params.command}`,
        skills: [{ id: params.command }],
        delivery: "queue",
      });
      return;
    }
    await client.session.command({
      sessionID: params.sessionID,
      name: params.command,
      text,
      delivery: "queue",
    });
  }

  async function findForm(requestID: string, sessionID?: string): Promise<FormInfo> {
    const cached = forms.get(requestID);
    if (cached) {
      return cached;
    }
    if (!sessionID) {
      throw new Error(`Unknown question request: ${requestID}`);
    }
    const form = await client.session.form.get({ sessionID, formID: requestID });
    rememberForm(form);
    return form;
  }

  function translatedStream(signal?: AbortSignal): AsyncGenerator<V1GlobalEvent> {
    const translate = createV2EventTranslator({
      onForm: rememberForm,
    });
    const queue: V1GlobalEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let failure: unknown;
    let lastDelivered = Date.now();

    const notify = () => {
      const resolve = wake;
      wake = null;
      resolve?.();
    };

    // Keepalive frames carry no event; they become heartbeats so an idle but healthy
    // stream does not look dead to the idle-timeout guard.
    const onActivity = () => {
      if (Date.now() - lastDelivered >= HEARTBEAT_INTERVAL_MS) {
        lastDelivered = Date.now();
        const heartbeat = {
          id: `heartbeat:${lastDelivered}`,
          type: "server.heartbeat",
          properties: {},
        };
        queue.push({ payload: heartbeat as unknown as Event });
        notify();
      }
    };

    void (async () => {
      try {
        for await (const event of client.event.subscribe({
          ...(signal ? { signal } : {}),
          onActivity,
        })) {
          for (const translated of translate(event)) {
            if (translated.payload.type === "permission.asked") {
              permissionSessions.set(
                translated.payload.properties.id,
                translated.payload.properties.sessionID,
              );
            }
            queue.push(translated);
          }
          notify();
        }
      } catch (error) {
        failure = error;
      } finally {
        finished = true;
        notify();
      }
    })();

    return (async function* () {
      while (true) {
        const next = queue.shift();
        if (next) {
          lastDelivered = Date.now();
          yield next;
          continue;
        }
        if (failure !== undefined) {
          throw failure;
        }
        if (finished) {
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    })();
  }

  const adapter = {
    global: {
      health: () =>
        run(async () => {
          const info = await client.server.info();
          return { healthy: true as const, version: info.version };
        }),
      event: async (eventOptions?: { signal?: AbortSignal }) => ({
        stream: translatedStream(eventOptions?.signal),
      }),
    },
    event: {
      subscribe: async (_params?: unknown, eventOptions?: { signal?: AbortSignal }) => ({
        stream: (async function* () {
          for await (const envelope of translatedStream(eventOptions?.signal)) {
            yield envelope.payload;
          }
        })(),
      }),
    },
    project: {
      list: () => run(async () => (await client.project.list()).map(toV1Project)),
    },
    experimental: {
      session: {
        list: (params: { roots?: boolean; limit?: number }) =>
          run(async () => {
            const result = await client.session.list({
              order: "desc",
              ...(params.limit ? { limit: params.limit } : {}),
              ...(params.roots ? { parentID: null } : {}),
            });
            return result.data.map(toV1GlobalSession);
          }),
      },
    },
    session: {
      list: (params: { directory?: string; limit?: number; roots?: boolean }) =>
        run(async () => {
          const result = await client.session.list({
            order: "desc",
            ...(params.directory ? { directory: params.directory } : {}),
            ...(params.limit ? { limit: params.limit } : {}),
            ...(params.roots ? { parentID: null } : {}),
          });
          return result.data.map(toV1Session);
        }),
      get: (params: { sessionID: string }) =>
        run(async () => toV1Session(await client.session.get({ sessionID: params.sessionID }))),
      create: (params: { directory: string; title?: string }) =>
        run(async () =>
          toV1Session(
            await client.session.create({
              location: { directory: params.directory },
              ...(params.title ? { title: params.title } : {}),
            }),
          ),
        ),
      update: (params: { sessionID: string; title?: string }) =>
        run(async () => {
          await client.session.update({
            sessionID: params.sessionID,
            ...(params.title !== undefined ? { title: params.title } : {}),
          });
          return toV1Session(await client.session.get({ sessionID: params.sessionID }));
        }),
      delete: (params: { sessionID: string }) =>
        run(async () => {
          await client.session.remove({ sessionID: params.sessionID });
          return true;
        }),
      status: () =>
        run(async () => {
          const active = await client.session.active();
          return Object.fromEntries(
            Object.keys(active).map((id) => [id, { type: "busy" as const }]),
          );
        }),
      messages: (params: { sessionID: string; limit?: number }) =>
        run(() => sessionMessages(params.sessionID, params.limit)),
      message: (params: { sessionID: string; messageID: string }) =>
        run(async () => {
          const [session, message] = await Promise.all([
            client.session.get({ sessionID: params.sessionID }),
            client.session.message.get({
              sessionID: params.sessionID,
              messageID: params.messageID,
            }),
          ]);
          const mapped = toV1Message(message, params.sessionID, session.location.directory);
          if (!mapped) {
            throw Object.assign(new Error(`Message not found: ${params.messageID}`), {
              name: "MessageNotFoundError",
            });
          }
          return mapped;
        }),
      promptAsync: (params: PromptParams) =>
        run(async () => {
          await admitPrompt(params);
          return undefined;
        }),
      prompt: (params: PromptParams) =>
        run(async () => {
          await admitPrompt(params);
          await client.session.wait({ sessionID: params.sessionID });
          return lastAssistantMessage(params.sessionID);
        }),
      command: (params: CommandParams) =>
        run(async () => {
          await runCommand(params);
          return undefined;
        }),
      abort: (params: { sessionID: string }) =>
        run(async () => {
          await client.session.interrupt({ sessionID: params.sessionID });
          return true;
        }),
      summarize: (params: { sessionID: string }) =>
        run(async () => {
          await client.session.compact({ sessionID: params.sessionID, delivery: "queue" });
          return true;
        }),
      diff: (params: { sessionID: string }) =>
        run(async () =>
          (await client.session.diff({ sessionID: params.sessionID })).map(toV1FileDiff),
        ),
      fork: (params: { sessionID: string; messageID?: string }) =>
        run(async () =>
          toV1Session(
            await client.session.fork({
              sessionID: params.sessionID,
              ...(params.messageID ? { before: params.messageID } : {}),
            }),
          ),
        ),
      revert: (params: { sessionID: string; messageID: string }) =>
        run(async () => {
          await client.session.revert.stage({
            sessionID: params.sessionID,
            messageID: params.messageID,
          });
          return toV1Session(await client.session.get({ sessionID: params.sessionID }));
        }),
    },
    config: {
      providers: () =>
        run(async () => {
          const [models, providers, defaultModel] = await Promise.all([
            client.model.list(),
            client.provider.list(),
            client.model.default(),
          ]);
          return {
            providers: toV1Providers(providers.data, models.data),
            default: defaultModel.data
              ? { [defaultModel.data.providerID]: defaultModel.data.id }
              : {},
          };
        }),
    },
    app: {
      agents: (params?: { directory?: string }) =>
        run(async () => (await client.agent.list(location(params?.directory))).data.map(toV1Agent)),
    },
    command: {
      list: (params?: { directory?: string }) =>
        run(async () => {
          const [commands, skills] = await Promise.all([
            client.command.list(location(params?.directory)),
            client.skill.list(location(params?.directory)),
          ]);
          return toV1Commands(commands.data, skills.data);
        }),
    },
    mcp: {
      status: (params?: { directory?: string }) =>
        run(async () => toV1McpStatus((await client.mcp.list(location(params?.directory))).data)),
      connect: (params: { name: string; directory?: string }) =>
        run(async () => {
          await client.mcp.connect({ server: params.name, ...location(params.directory) });
          return true;
        }),
      disconnect: (params: { name: string; directory?: string }) =>
        run(async () => {
          await client.mcp.disconnect({ server: params.name, ...location(params.directory) });
          return true;
        }),
    },
    question: {
      list: (params?: { directory?: string }) =>
        run(async () => {
          const result = await client.form.list(location(params?.directory));
          return result.data.map((form) => {
            rememberForm(form);
            return toV1Question(form);
          });
        }),
      reply: (params: { requestID: string; answers?: string[][]; sessionID?: string }) =>
        run(async () => {
          const form = await findForm(params.requestID, params.sessionID);
          await client.session.form.reply({
            sessionID: form.sessionID,
            formID: form.id,
            answer: toFormAnswer(form, params.answers ?? []),
          });
          forms.delete(form.id);
          return true;
        }),
      reject: (params: { requestID: string; sessionID?: string }) =>
        run(async () => {
          const form = await findForm(params.requestID, params.sessionID);
          await client.session.form.cancel({ sessionID: form.sessionID, formID: form.id });
          forms.delete(form.id);
          return true;
        }),
    },
    permission: {
      list: (params?: { directory?: string }) =>
        run(async () => {
          const result = await client.permission.request.list(location(params?.directory));
          return result.data.map((request) => {
            permissionSessions.set(request.id, request.sessionID);
            return toV1Permission(request);
          });
        }),
      reply: (params: {
        requestID: string;
        reply?: "once" | "always" | "reject";
        message?: string;
        sessionID?: string;
      }) =>
        run(async () => {
          const sessionID = params.sessionID ?? permissionSessions.get(params.requestID);
          if (!sessionID) {
            throw new Error(`Unknown permission request: ${params.requestID}`);
          }
          await client.permission.reply({
            sessionID,
            requestID: params.requestID,
            decision: params.reply ?? "once",
            ...(params.message ? { message: params.message } : {}),
          });
          permissionSessions.delete(params.requestID);
          return true;
        }),
    },
  };

  // The adapter implements exactly the part of the V1 client surface the bot calls.
  return adapter as unknown as OpencodeClient;
}

/**
 * URL of the V2 background server registered for this user, or null when no registered
 * server answers. There is one per user: a new registered server replaces it.
 */
export async function findRegisteredV2ServerUrl(): Promise<string | null> {
  try {
    return (await Service.discover())?.url ?? null;
  } catch {
    return null;
  }
}
