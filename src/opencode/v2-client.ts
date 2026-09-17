import {
  OpenCode,
  type OpenCodeClient,
  type ModelRef,
  type SessionInfo,
  type SessionMessageInfo,
} from "@opencode/client";
import type { FilePartInput, Provider, SessionStatus } from "@opencode-ai/sdk/v2";
import type { BotOpenCodeClient } from "./types.js";
import {
  mapAgent,
  mapForm,
  mapFormAnswers,
  mapMessage,
  mapModel,
  mapPermission,
  mapSession,
} from "./v2-mappers.js";
import { createV2EventMapper, subscribeV2Events } from "./v2-events.js";

type RequestOptions = { signal?: AbortSignal | null; throwOnError?: boolean };
const scope = (directory?: string) => (directory ? { location: { directory } } : {});
const nativeOptions = (options?: RequestOptions) =>
  options?.signal ? { signal: options.signal } : undefined;

async function result<T>(
  operation: () => Promise<T>,
  options?: RequestOptions,
): Promise<{ data: T; error?: never } | { data?: never; error: unknown }> {
  try {
    return { data: await operation() };
  } catch (error) {
    if (options?.throwOnError) throw error;
    return { error };
  }
}

function files(parts: Array<FilePartInput | { type: string }> | undefined) {
  return (parts ?? [])
    .filter((part): part is FilePartInput => part.type === "file")
    .map((part) => ({ uri: part.url, ...(part.filename ? { name: part.filename } : {}) }));
}

export function createV2Client(options: OpenCode.ClientOptions): BotOpenCodeClient {
  const request = options.fetch ?? globalThis.fetch;
  return adaptV2Client(
    OpenCode.make({
      ...options,
      fetch: async (input, init) => {
        const response = await request(input, init);
        const url = new URL(input instanceof Request ? input.url : String(input));
        // Released 2.0.4 exposes the same server info at /api/status.
        if (response.status === 404 && url.pathname.endsWith("/api/info")) {
          await response.body?.cancel();
          url.pathname = url.pathname.replace(/\/api\/info$/, "/api/status");
          return request(input instanceof Request ? new Request(url, input) : url, init);
        }
        return response;
      },
    }),
  );
}

export function adaptV2Client(client: OpenCodeClient): BotOpenCodeClient {
  async function selectSettings(
    sessionID: string,
    agent?: string,
    model?: ModelRef,
    options?: RequestOptions,
  ) {
    if (agent) await client.session.switchAgent({ sessionID, agent }, nativeOptions(options));
    if (model) await client.session.switchModel({ sessionID, model }, nativeOptions(options));
  }

  async function listMessages(sessionID: string, limit?: number, options?: RequestOptions) {
    const messages: SessionMessageInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.message.list(
        { sessionID, ...(cursor ? { cursor } : { order: "desc" as const, limit: limit ?? 100 }) },
        nativeOptions(options),
      );
      messages.push(...page.data);
      cursor = page.cursor.next ?? undefined;
    } while (cursor && limit === undefined);
    // Legacy SDK returns messages chronologically, including when limited.
    return messages.reverse();
  }

  const prompt: BotOpenCodeClient["session"]["promptAsync"] = (input, options) =>
    result(async () => {
      await selectSettings(
        input.sessionID,
        input.agent,
        input.model
          ? {
              id: input.model.modelID,
              providerID: input.model.providerID,
              ...(input.variant && input.variant !== "default" ? { variant: input.variant } : {}),
            }
          : undefined,
        options,
      );
      // V2 system instructions are scoped to the session rather than each prompt.
      if (input.system)
        await client.session.instructions.entry.put(
          {
            sessionID: input["sessionID"],
            key: "telegram.prompt.system",
            value: input.system,
          },
          nativeOptions(options),
        );
      await client.session.prompt(
        {
          sessionID: input["sessionID"],
          text: (input.parts ?? [])
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
          files: files(input.parts),
        },
        nativeOptions(options),
      );
      return undefined;
    }, options);

  async function findForm(requestID: string, directory?: string, options?: RequestOptions) {
    const { data } = await client.form.list(scope(directory), nativeOptions(options));
    const form = data.find((item) => item.id === requestID);
    if (!form) throw new Error(`Pending OpenCode form not found: ${requestID}`);
    return form;
  }

  return {
    global: {
      health: (options) =>
        result(
          async () => ({ healthy: true, ...(await client.server.info(nativeOptions(options))) }),
          options,
        ),
      event: async (options) => ({ stream: subscribeV2Events(client, options) }),
    },
    event: {
      subscribe: async (input, options) => ({
        stream: (async function* () {
          const convert = createV2EventMapper(client, options?.signal);
          for await (const event of client.event.subscribe(options)) {
            // The global subscription is used normally; this also preserves project filtering on reconnect.
            if (input?.directory && event.location && event.location.directory !== input.directory)
              continue;
            for (const [index, mapped] of (await convert(event)).entries())
              yield { ...mapped, id: `${event.id}:${index}` };
          }
        })(),
      }),
    },
    session: {
      list: (input, options) =>
        result(async () => {
          const sessions: SessionInfo[] = [];
          let cursor: string | undefined;
          do {
            const page = await client.session.list(
              cursor
                ? { cursor }
                : {
                    directory: input?.directory,
                    ...(input?.roots ? { parentID: null } : {}),
                    search: input?.search,
                    limit: input?.limit ?? 100,
                    order: "desc",
                  },
              nativeOptions(options),
            );
            sessions.push(...page.data);
            cursor = page.cursor.next ?? undefined;
          } while (cursor && input?.limit === undefined);
          return sessions.map(mapSession);
        }, options),
      create: (input, options) =>
        result(
          async () =>
            mapSession(
              await client.session.create(
                {
                  ...scope(input?.directory),
                  ...(input?.title ? { title: input.title } : {}),
                },
                nativeOptions(options),
              ),
            ),
          options,
        ),
      get: (input, options) =>
        result(
          async () => mapSession(await client.session.get(input, nativeOptions(options))),
          options,
        ),
      update: (input, options) =>
        result(async () => {
          await client.session.update(
            { sessionID: input["sessionID"], title: input.title },
            nativeOptions(options),
          );
          return mapSession(await client.session.get(input, nativeOptions(options)));
        }, options),
      delete: (input, options) =>
        result(async () => {
          await client.session.remove(input, nativeOptions(options));
          return true;
        }, options),
      status: (_input, options) =>
        result(async () => {
          const active = await client.session.active(nativeOptions(options));
          return Object.fromEntries(
            Object.keys(active).map((id) => [id, { type: "busy" } satisfies SessionStatus]),
          );
        }, options),
      messages: (input, options) =>
        result(async () => {
          const [session, messages] = await Promise.all([
            client.session.get(input, nativeOptions(options)),
            listMessages(input.sessionID, input.limit, options),
          ]);
          return messages.flatMap((message) => {
            const mapped = mapMessage(message, session);
            return mapped ? [mapped] : [];
          });
        }, options),
      promptAsync: prompt,
      prompt: (input, options) =>
        result(async () => {
          const started = await prompt(input, { ...options, throwOnError: true });
          if (started.error) throw started.error;
          await client.session.wait({ sessionID: input["sessionID"] }, nativeOptions(options));
          const [session, messages] = await Promise.all([
            client.session.get(input, nativeOptions(options)),
            listMessages(input.sessionID, undefined, options),
          ]);
          const last = messages.reverse().find((message) => message.type === "assistant");
          if (!last || last.type !== "assistant")
            throw new Error("OpenCode completed without an assistant message");
          const mapped = mapMessage(last, session);
          if (!mapped || mapped.info.role !== "assistant")
            throw new Error("Invalid OpenCode assistant response");
          return { info: mapped.info, parts: mapped.parts };
        }, options),
      command: (input, options) =>
        result(async () => {
          if (!input.command) throw new Error("A command name is required");
          const separator = input.model?.indexOf("/") ?? -1;
          await selectSettings(
            input.sessionID,
            input.agent,
            input.model && separator > 0
              ? {
                  providerID: input.model.slice(0, separator),
                  id: input.model.slice(separator + 1),
                  ...(input.variant && input.variant !== "default"
                    ? { variant: input.variant }
                    : {}),
                }
              : undefined,
            options,
          );
          const catalog = await client.skill.list(scope(input.directory), nativeOptions(options));
          const skill = catalog.data.find((item) => item.id === input.command);
          if (skill) {
            await client.session.prompt(
              {
                sessionID: input["sessionID"],
                text: input.arguments ?? "",
                skills: [{ id: skill.id }],
                files: files(input.parts),
              },
              nativeOptions(options),
            );
          } else {
            await client.session.command(
              {
                sessionID: input["sessionID"],
                name: input.command,
                text: input.arguments ?? "",
                files: files(input.parts),
              },
              nativeOptions(options),
            );
          }
          return undefined;
        }, options),
      abort: (input, options) =>
        result(async () => {
          await client.session.interrupt(input, nativeOptions(options));
          return true;
        }, options),
      fork: (input, options) =>
        result(
          async () =>
            mapSession(
              await client.session.fork(
                {
                  sessionID: input["sessionID"],
                  before: input.messageID,
                },
                nativeOptions(options),
              ),
            ),
          options,
        ),
      revert: (input, options) =>
        result(async () => {
          if (!input.messageID) throw new Error("A message ID is required to revert a session");
          await client.session.revert.stage(
            { sessionID: input["sessionID"], messageID: input.messageID, files: true },
            nativeOptions(options),
          );
          return mapSession(await client.session.get(input, nativeOptions(options)));
        }, options),
      summarize: (input, options) =>
        result(async () => {
          if (input.providerID && input.modelID) {
            await selectSettings(
              input.sessionID,
              undefined,
              {
                providerID: input.providerID,
                id: input.modelID,
              },
              options,
            );
          }
          await client.session.compact({ sessionID: input["sessionID"] }, nativeOptions(options));
          await client.session.wait({ sessionID: input["sessionID"] }, nativeOptions(options));
          return true;
        }, options),
      diff: (input, options) =>
        result(
          async () =>
            (
              await client.session.diff(
                { sessionID: input["sessionID"], from: input.messageID },
                nativeOptions(options),
              )
            ).map((diff) => ({ ...diff, before: "", after: "" })),
          options,
        ),
    },
    project: {
      list: (_input, options) =>
        result(
          async () =>
            (await client.project.list(nativeOptions(options))).map(({ vcs, ...project }) => ({
              ...project,
              worktree: project.canonical,
              ...(vcs === "git" ? { vcs: "git" as const } : {}),
            })),
          options,
        ),
    },
    config: {
      providers: (input, options) =>
        result(async () => {
          const [providers, models] = await Promise.all([
            client.provider.list(scope(input?.directory), nativeOptions(options)),
            client.model.list(scope(input?.directory), nativeOptions(options)),
          ]);
          return {
            providers: providers.data
              .filter((provider) => provider.activation !== "disabled")
              .map((provider): Provider => ({
                id: provider.id,
                name: provider.name,
                source: "api",
                env: [],
                options: {},
                models: Object.fromEntries(
                  models.data
                    .filter((model) => model.providerID === provider.id && model.enabled)
                    .map((model) => [model.id, mapModel(model)]),
                ),
              })),
            default: {},
          };
        }, options),
    },
    app: {
      agents: (input, options) =>
        result(
          async () =>
            (await client.agent.list(scope(input?.directory), nativeOptions(options))).data.map(
              mapAgent,
            ),
          options,
        ),
    },
    command: {
      list: (input, options) =>
        result(async () => {
          const [commands, skills] = await Promise.all([
            client.command.list(scope(input?.directory), nativeOptions(options)),
            client.skill.list(scope(input?.directory), nativeOptions(options)),
          ]);
          return [
            ...commands.data.map((command) => ({
              ...command,
              template: "",
              hints: [],
              source: "command" as const,
            })),
            ...skills.data.map((skill) => ({
              name: skill.id,
              ...(skill.description ? { description: skill.description } : {}),
              template: "",
              hints: [],
              source: "skill" as const,
            })),
          ];
        }, options),
    },
    mcp: {
      status: (input, options) =>
        result(
          async () =>
            Object.fromEntries(
              (await client.mcp.list(scope(input?.directory), nativeOptions(options))).data.map(
                (server) => [
                  server.name,
                  server.status.status === "pending"
                    ? { status: "disabled" as const }
                    : server.status,
                ],
              ),
            ),
          options,
        ),
      connect: (input, options) =>
        result(async () => {
          await client.mcp.connect(
            { ...scope(input.directory), server: input.name },
            nativeOptions(options),
          );
          return true;
        }, options),
      disconnect: (input, options) =>
        result(async () => {
          await client.mcp.disconnect(
            { ...scope(input.directory), server: input.name },
            nativeOptions(options),
          );
          return true;
        }, options),
    },
    question: {
      list: (input, options) =>
        result(
          async () =>
            (await client.form.list(scope(input?.directory), nativeOptions(options))).data.map(
              mapForm,
            ),
          options,
        ),
      reply: (input, options) =>
        result(async () => {
          const form = await findForm(input.requestID, input.directory, options);
          await client.session.form.reply(
            {
              sessionID: form["sessionID"],
              formID: form.id,
              answer: mapFormAnswers(form, input.answers ?? []),
            },
            nativeOptions(options),
          );
          return true;
        }, options),
      reject: (input, options) =>
        result(async () => {
          const form = await findForm(input.requestID, input.directory, options);
          await client.session.form.cancel(
            { sessionID: form["sessionID"], formID: form.id },
            nativeOptions(options),
          );
          return true;
        }, options),
    },
    permission: {
      list: (input, options) =>
        result(
          async () =>
            (
              await client.permission.request.list(scope(input?.directory), nativeOptions(options))
            ).data.map(mapPermission),
          options,
        ),
      reply: (input, options) =>
        result(async () => {
          const { data } = await client.permission.request.list(
            scope(input.directory),
            nativeOptions(options),
          );
          const request = data.find((item) => item.id === input.requestID);
          if (!request)
            throw new Error(`Pending OpenCode permission not found: ${input.requestID}`);
          if (!input.reply) throw new Error("A permission decision is required");
          await client.permission.reply(
            { sessionID: request["sessionID"], requestID: input.requestID, decision: input.reply },
            nativeOptions(options),
          );
          return true;
        }, options),
    },
  };
}
