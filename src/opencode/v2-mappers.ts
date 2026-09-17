import type {
  AgentInfo,
  FormAnswer,
  FormInfo,
  ModelInfo,
  PermissionRequest as V2Permission,
  SessionInfo,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  TokenUsageInfo,
} from "@opencode/client";
import type {
  Agent,
  AssistantMessage,
  Message,
  Model,
  Part,
  PermissionRequest,
  QuestionRequest,
  Session,
  ToolPart,
} from "@opencode-ai/sdk/v2";

export const emptyTokens = (): TokenUsageInfo => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
});

export function mapSession(session: SessionInfo): Session {
  return {
    ...session,
    slug: session.id,
    title: session.title ?? session.id,
    directory: session.location.directory,
    version: "2",
  };
}

// Keep the bot's existing tool renderers and subagent tracking working with V2 names.
export function mapToolName(name: string): string {
  return (
    ({ shell: "bash", subagent: "task", patch: "apply_patch" } as Record<string, string>)[name] ??
    name
  );
}

export function mapTool(
  tool: SessionMessageAssistantTool,
  sessionID: string,
  messageID: string,
): ToolPart {
  const base = {
    id: tool.id,
    sessionID,
    messageID,
    type: "tool" as const,
    callID: tool.id,
    tool: mapToolName(tool.name),
  };
  const state = tool.state;
  const start = tool.time.ran ?? tool.time.created;
  if (state.status === "streaming") {
    return { ...base, state: { status: "pending", input: {}, raw: state.input } };
  }
  const input =
    tool.name === "subagent" && typeof state.input.agent === "string"
      ? { ...state.input, subagent_type: state.input.agent }
      : state.input;
  const metadata = state.metadata ?? {};
  const title = typeof metadata.title === "string" ? metadata.title : tool.name;
  if (state.status === "running") {
    return { ...base, state: { ...state, input, title, time: { start } } };
  }
  const time = { start, end: tool.time.completed ?? start };
  if (state.status === "error") {
    return {
      ...base,
      state: { status: "error", input, error: state.error.message, metadata, time },
    };
  }
  return {
    ...base,
    state: {
      status: "completed",
      input,
      metadata,
      title,
      time,
      output: state.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
      attachments: state.content
        .filter((item) => item.type === "file")
        .map((item, index) => ({
          id: `${tool.id}:file:${index}`,
          sessionID,
          messageID,
          type: "file" as const,
          url: item.uri,
          mime: item.mime,
          ...(item.name ? { filename: item.name } : {}),
        })),
    },
  };
}

export type BotMessage = { info: Message; parts: Part[] };

export function mapMessage(
  message: SessionMessageInfo,
  session: Pick<SessionInfo, "id" | "location" | "agent" | "model">,
): BotMessage | undefined {
  const sessionID = session["id"];
  const base = { sessionID, messageID: message.id };
  if (message.type === "user") {
    return {
      info: {
        id: message.id,
        sessionID,
        role: "user",
        time: message.time,
        agent: session.agent ?? "build",
        model: { providerID: session.model?.providerID ?? "", modelID: session.model?.id ?? "" },
      },
      parts: [
        { ...base, id: `${message.id}:text`, type: "text", text: message.text },
        ...(message.files ?? []).map((file, index): Part => ({
          ...base,
          id: `${message.id}:file:${index}`,
          type: "file",
          mime: file.mime,
          url:
            file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
          ...(file.name ? { filename: file.name } : {}),
        })),
      ],
    };
  }
  if (message.type !== "assistant") return undefined;
  const info: AssistantMessage = {
    id: message.id,
    sessionID,
    role: "assistant",
    time: message.time,
    parentID: "",
    modelID: message.model.id,
    providerID: message.model.providerID,
    agent: message.agent,
    mode: message.agent,
    path: { cwd: session.location.directory, root: session.location.directory },
    cost: message.cost ?? 0,
    tokens: message.tokens ?? emptyTokens(),
    ...(message.model.variant ? { variant: message.model.variant } : {}),
    ...(message.finish ? { finish: message.finish } : {}),
    ...(message.error
      ? { error: { name: "UnknownError" as const, data: { message: message.error.message } } }
      : {}),
  };
  return {
    info,
    parts: message.content.map((part, index): Part => {
      if (part.type === "tool") return mapTool(part, sessionID, message.id);
      const id = `${message.id}:${index}`;
      if (part.type === "reasoning") {
        return {
          ...base,
          id,
          type: "reasoning",
          text: part.text,
          time: {
            start: part.time?.created ?? message.time.created,
            ...(part.time?.completed !== undefined ? { end: part.time.completed } : {}),
          },
        };
      }
      return { ...base, id, type: "text", text: part.text };
    }),
  };
}

export function mapAgent(agent: AgentInfo): Agent {
  return {
    name: agent.id,
    ...(agent.description ? { description: agent.description } : {}),
    mode: agent.mode,
    hidden: agent.hidden,
    options: agent.request.settings,
    permission: agent.permissions.map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    ...(agent.model
      ? {
          model: { modelID: agent.model.id, providerID: agent.model.providerID },
          ...(agent.model.variant ? { variant: agent.model.variant } : {}),
        }
      : {}),
  };
}

export function mapModel(model: ModelInfo): Model {
  const modalities = (values: string[]) => ({
    text: values.includes("text"),
    audio: values.includes("audio"),
    image: values.includes("image"),
    video: values.includes("video"),
    pdf: values.includes("pdf"),
  });
  const cost = model.cost.find((item) => !item.tier) ?? model.cost[0];
  return {
    id: model.id,
    providerID: model.providerID,
    name: model.name,
    api: { id: model.modelID, url: "", npm: model.package ?? "" },
    capabilities: {
      temperature: false,
      reasoning: model.variants.length > 0,
      attachment: model.capabilities.input.some((item) => item !== "text"),
      toolcall: model.capabilities.tools,
      input: modalities(model.capabilities.input),
      output: modalities(model.capabilities.output),
      interleaved: false,
    },
    cost: {
      input: cost?.input ?? 0,
      output: cost?.output ?? 0,
      cache: { read: cost?.cache?.read ?? 0, write: cost?.cache?.write ?? 0 },
    },
    limit: model.limit,
    status: model.status,
    options: model.settings ?? {},
    headers: model.headers ?? {},
    release_date: model.time.released
      ? new Date(model.time.released).toISOString().slice(0, 10)
      : "",
    variants: Object.fromEntries(
      model.variants.map((variant) => [variant.id, variant.settings ?? {}]),
    ),
  };
}

export function mapPermission(request: V2Permission): PermissionRequest {
  return {
    id: request.id,
    sessionID: request["sessionID"],
    permission: mapToolName(request.action),
    patterns: request.resources,
    always: request.save ?? [],
    metadata: request.metadata ?? {},
    ...(request.source
      ? { tool: { messageID: request.source.messageID, callID: request.source.id } }
      : {}),
  };
}

export function mapForm(form: FormInfo): QuestionRequest {
  return {
    id: form.id,
    sessionID: form["sessionID"],
    questions: form.fields.map((field) => {
      const options =
        "options" in field
          ? (field.options ?? []).map((option) => ({
              label: option.label,
              description: option.description ?? "",
            }))
          : field.type === "boolean"
            ? [
                { label: "true", description: "" },
                { label: "false", description: "" },
              ]
            : [];
      return {
        header: (field.title ?? form.title).slice(0, 30),
        question: [
          field.title ?? form.title,
          field.description,
          field.type === "external" ? field.url : undefined,
        ]
          .filter(Boolean)
          .join("\n\n"),
        options,
        multiple: field.type === "multiselect",
        custom:
          "custom" in field ? (field.custom ?? options.length === 0) : field.type !== "boolean",
      };
    }),
  };
}

export function mapFormAnswers(form: FormInfo, answers: string[][]): FormAnswer {
  const result: FormAnswer = {};
  for (const [index, field] of form.fields.entries()) {
    if (field.type === "external") continue;
    const selected = answers[index] ?? [];
    const options = "options" in field ? (field.options ?? []) : [];
    const values = selected.map(
      (label) => options.find((option) => option.label === label)?.value ?? label,
    );
    const value = values[0];
    if (field.type === "multiselect") result[field.key] = values;
    else if (value !== undefined) {
      if (field.type === "boolean") {
        if (value !== "true" && value !== "false")
          throw new Error(`Invalid boolean answer for ${field.key}`);
        result[field.key] = value === "true";
      } else if (field.type === "number" || field.type === "integer") {
        const number = Number(value);
        if (
          !value.trim() ||
          !Number.isFinite(number) ||
          (field.type === "integer" && !Number.isInteger(number))
        ) {
          throw new Error(`Invalid numeric answer for ${field.key}`);
        }
        result[field.key] = number;
      } else result[field.key] = value;
    }
  }
  for (const field of form.fields) {
    if (
      "when" in field &&
      field.when?.some((condition) =>
        condition.op === "eq"
          ? result[condition.key] !== condition.value
          : result[condition.key] === condition.value,
      )
    ) {
      delete result[field.key];
    }
  }
  return result;
}
