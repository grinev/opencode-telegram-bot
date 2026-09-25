import type {
  Agent,
  AssistantMessage,
  Command,
  FileDiff,
  FilePartInput,
  GlobalSession,
  McpStatus,
  Message,
  Model,
  Part,
  PermissionRequest,
  Project,
  Provider,
  QuestionInfo,
  QuestionRequest,
  Session,
  TextPartInput,
  ToolState,
  UserMessage,
} from "@opencode-ai/sdk/v2";
import type {
  AgentInfo,
  FileDiffInfo,
  FormField,
  FormInfo,
  McpServer,
  ModelInfo,
  PermissionRequest as V2PermissionRequest,
  Project as V2Project,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStructuredError,
  SkillInfo,
} from "@opencode/client";

type JsonRecord = Record<string, unknown>;

export interface V1MessageWithParts {
  info: Message;
  parts: Part[];
}

/** V2 tool ids that the bot's formatters know under their V1 names. */
const V1_TOOL_NAMES: Record<string, string> = {
  shell: "bash",
  subagent: "task",
  patch: "apply_patch",
};

export function toV1ToolName(name: string): string {
  return V1_TOOL_NAMES[name] ?? name;
}

/** Adds the V1 input field names the formatters read, keeping the V2 ones. */
export function toV1ToolInput(tool: string, input: JsonRecord): JsonRecord {
  const result: JsonRecord = { ...input };
  if (typeof result.filePath !== "string" && typeof result.path === "string") {
    result.filePath = result.path;
  }
  if (tool === "task" && typeof result.subagent_type !== "string") {
    const agent = result.agent ?? result.subagent ?? result.type;
    if (typeof agent === "string") {
      result.subagent_type = agent;
    }
  }
  if (tool === "apply_patch" && typeof result.patchText !== "string") {
    const patch = result.patch ?? result.text;
    if (typeof patch === "string") {
      result.patchText = patch;
    }
  }
  return result;
}

export function toolContentText(
  content: ReadonlyArray<{ type: string; text?: string }> | undefined,
): string {
  if (!content) {
    return "";
  }
  return content
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function toV1ErrorPayload(
  error: SessionStructuredError | undefined,
): NonNullable<AssistantMessage["error"]> {
  return {
    name: "UnknownError",
    data: { message: error?.message || error?.type || "Unknown error" },
  };
}

export function toV1Session(session: SessionInfo): Session {
  return {
    id: session.id,
    slug: session.id,
    projectID: session.projectID,
    directory: session.location.directory,
    ...(session.parentID ? { parentID: session.parentID } : {}),
    cost: session.cost,
    tokens: session.tokens,
    title: session.title ?? "",
    ...(session.agent ? { agent: session.agent } : {}),
    ...(session.model ? { model: session.model } : {}),
    version: "v2",
    time: {
      created: session.time.created,
      updated: session.time.updated,
      ...(session.time.archived ? { archived: session.time.archived } : {}),
    },
  };
}

export function toV1GlobalSession(session: SessionInfo): GlobalSession {
  return { ...toV1Session(session), project: null };
}

export function toV1Project(project: V2Project): Project {
  return {
    id: project.id,
    worktree: project.canonical,
    ...(project.name ? { name: project.name } : {}),
    time: project.time as Project["time"],
    sandboxes: project.sandboxes,
  };
}

function toV1UserMessage(message: SessionMessageUser, sessionID: string): V1MessageWithParts {
  const info: UserMessage = {
    id: message.id,
    sessionID,
    role: "user",
    time: { created: message.time.created },
    agent: "",
    model: { providerID: "", modelID: "" },
  };
  const parts: Part[] = [
    {
      id: `${message.id}:text`,
      sessionID,
      messageID: message.id,
      type: "text",
      text: message.text,
    },
  ];
  for (const [index, file] of (message.files ?? []).entries()) {
    parts.push({
      id: `${message.id}:file:${index}`,
      sessionID,
      messageID: message.id,
      type: "file",
      mime: file.mime,
      ...(file.name ? { filename: file.name } : {}),
      url: file.source.type === "uri" ? file.source.uri : `data:${file.mime};base64,${file.data}`,
    });
  }
  return { info, parts };
}

function toV1ToolState(
  tool: Extract<SessionMessageAssistant["content"][number], { type: "tool" }>,
  toolName: string,
): ToolState {
  const start = tool.time.ran ?? tool.time.created;
  const end = tool.time.completed ?? start;
  const state = tool.state;
  if (state.status === "streaming") {
    return { status: "pending", input: {}, raw: state.input };
  }
  const input = toV1ToolInput(toolName, state.input);
  if (state.status === "running") {
    return { status: "running", input, metadata: state.metadata, time: { start } };
  }
  if (state.status === "completed") {
    return {
      status: "completed",
      input,
      output: toolContentText(state.content),
      title: "",
      metadata: state.metadata ?? {},
      time: { start, end },
    };
  }
  return {
    status: "error",
    input,
    error: state.error.message,
    ...(state.metadata ? { metadata: state.metadata } : {}),
    time: { start, end },
  };
}

function toV1AssistantMessage(
  message: SessionMessageAssistant,
  sessionID: string,
  directory: string,
): V1MessageWithParts {
  const info: AssistantMessage = {
    id: message.id,
    sessionID,
    role: "assistant",
    time: {
      created: message.time.created,
      ...(message.time.completed ? { completed: message.time.completed } : {}),
    },
    ...(message.error ? { error: toV1ErrorPayload(message.error) } : {}),
    parentID: "",
    modelID: message.model.id,
    providerID: message.model.providerID,
    mode: message.agent,
    agent: message.agent,
    path: { cwd: directory, root: directory },
    cost: message.cost ?? 0,
    tokens: message.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(message.model.variant ? { variant: message.model.variant } : {}),
    ...(message.finish ? { finish: message.finish } : {}),
  };

  const parts: Part[] = message.content.map((item, index): Part => {
    const base = { id: `${message.id}:${item.type}:${index}`, sessionID, messageID: message.id };
    if (item.type === "text") {
      return { ...base, type: "text", text: item.text };
    }
    if (item.type === "reasoning") {
      return {
        ...base,
        type: "reasoning",
        text: item.text,
        time: {
          start: item.time?.created ?? message.time.created,
          ...(item.time?.completed ? { end: item.time.completed } : {}),
        },
      };
    }
    const toolName = toV1ToolName(item.name);
    return {
      ...base,
      id: item.id,
      type: "tool",
      callID: item.id,
      tool: toolName,
      state: toV1ToolState(item, toolName),
    };
  });

  return { info, parts };
}

/** Maps the user and assistant entries of a V2 message list; other entry kinds have no V1 form. */
export function toV1Message(
  message: SessionMessageInfo,
  sessionID: string,
  directory: string,
): V1MessageWithParts | null {
  if (message.type === "user") {
    return toV1UserMessage(message, sessionID);
  }
  if (message.type === "assistant") {
    return toV1AssistantMessage(message, sessionID, directory);
  }
  return null;
}

export function toV1FileDiff(diff: FileDiffInfo): FileDiff {
  return {
    path: diff.file,
    status: diff.status,
    additions: diff.additions,
    deletions: diff.deletions,
    patch: diff.patch,
  };
}

function hasModality(list: ReadonlyArray<string>, modality: string): boolean {
  return list.includes(modality);
}

export function toV1Model(model: ModelInfo): Model {
  const input = model.capabilities.input;
  const output = model.capabilities.output;
  const cost = model.cost[0];
  return {
    id: model.id,
    providerID: model.providerID,
    api: { id: model.modelID, url: "", npm: model.package ?? "" },
    name: model.name,
    ...(model.family ? { family: model.family } : {}),
    capabilities: {
      temperature: true,
      reasoning: model.variants.some((variant) => variant.id !== "none"),
      attachment: input.some((modality) => modality !== "text"),
      toolcall: model.capabilities.tools,
      input: {
        text: hasModality(input, "text"),
        audio: hasModality(input, "audio"),
        image: hasModality(input, "image"),
        video: hasModality(input, "video"),
        pdf: hasModality(input, "pdf"),
      },
      output: {
        text: hasModality(output, "text"),
        audio: hasModality(output, "audio"),
        image: hasModality(output, "image"),
        video: hasModality(output, "video"),
        pdf: hasModality(output, "pdf"),
      },
      interleaved: false,
    },
    cost: {
      input: Number(cost?.input ?? 0),
      output: Number(cost?.output ?? 0),
      cache: { read: Number(cost?.cache.read ?? 0), write: Number(cost?.cache.write ?? 0) },
    },
    limit: model.limit,
    status: model.status,
    options: {},
    headers: {},
    release_date: new Date(model.time.released).toISOString().slice(0, 10),
    variants: Object.fromEntries(
      model.variants.map((variant) => [variant.id, variant.settings ?? {}]),
    ),
  };
}

export function toV1Providers(
  providers: ReadonlyArray<{ id: string; name: string }>,
  models: ReadonlyArray<ModelInfo>,
): Provider[] {
  const names = new Map(providers.map((provider) => [provider.id, provider.name]));
  const byProvider = new Map<string, Provider>();
  for (const model of models) {
    if (!model.enabled) {
      continue;
    }
    let provider = byProvider.get(model.providerID);
    if (!provider) {
      provider = {
        id: model.providerID,
        name: names.get(model.providerID) ?? model.providerID,
        source: "api",
        env: [],
        options: {},
        models: {},
      };
      byProvider.set(model.providerID, provider);
    }
    provider.models[model.id] = toV1Model(model);
  }
  return [...byProvider.values()];
}

export function toV1Agent(agent: AgentInfo): Agent {
  return {
    name: agent.id,
    ...(agent.description ? { description: agent.description } : {}),
    mode: agent.mode,
    hidden: agent.hidden,
    ...(agent.color ? { color: agent.color } : {}),
    permission: [],
    ...(agent.model
      ? { model: { modelID: agent.model.id, providerID: agent.model.providerID } }
      : {}),
    options: {},
    ...(agent.steps ? { steps: agent.steps } : {}),
  };
}

export function toV1Commands(
  commands: ReadonlyArray<{ name: string; description?: string }>,
  skills: ReadonlyArray<SkillInfo>,
): Command[] {
  return [
    ...commands.map((command): Command => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      source: "command",
      template: "",
      hints: [],
    })),
    ...skills.map((skill): Command => ({
      name: skill.id,
      ...(skill.description ? { description: skill.description } : {}),
      source: "skill",
      template: "",
      hints: [],
    })),
  ];
}

export function toV1McpStatus(servers: ReadonlyArray<McpServer>): Record<string, McpStatus> {
  const result: Record<string, McpStatus> = {};
  for (const server of servers) {
    const status = server.status;
    if (status.status === "connected" || status.status === "disabled") {
      result[server.name] = { status: status.status };
    } else if (status.status === "needs_auth") {
      result[server.name] = { status: "needs_auth" };
    } else if (status.status === "failed") {
      result[server.name] = { status: "failed", error: status.error };
    } else {
      result[server.name] = { status: "failed", error: status.status };
    }
  }
  return result;
}

export function toV1Permission(request: V2PermissionRequest): PermissionRequest {
  return {
    id: request.id,
    sessionID: request.sessionID,
    permission: request.action,
    patterns: request.resources,
    metadata: request.metadata ?? {},
    always: request.save ?? [],
  };
}

function isFieldVisible(field: FormField, answers: ReadonlyMap<string, unknown>): boolean {
  if ("hidden" in field && field.hidden) {
    return false;
  }
  const conditions = "when" in field ? field.when : undefined;
  if (!conditions || conditions.length === 0) {
    return true;
  }
  return conditions.every((condition) => {
    const value = answers.get(condition.key);
    const matches = value === condition.value;
    return condition.op === "eq" ? matches : !matches;
  });
}

function defaultFieldValue(field: FormField): unknown {
  return "default" in field ? field.default : undefined;
}

/**
 * The fields of a form that are shown as questions. Conditions are evaluated against the
 * fields' defaults, because the bot shows the whole form at once.
 */
export function visibleFormFields(form: FormInfo): FormField[] {
  const defaults = new Map(form.fields.map((field) => [field.key, defaultFieldValue(field)]));
  return form.fields.filter((field) => isFieldVisible(field, defaults));
}

function fieldHeader(field: FormField, form: FormInfo): string {
  return field.title ?? form.title;
}

function fieldQuestionText(field: FormField, form: FormInfo): string {
  const parts = [field.title ?? form.title, field.description].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  if (field.type === "external") {
    parts.push(field.url);
  }
  return parts.join("\n\n") || field.key;
}

function toQuestionInfo(field: FormField, form: FormInfo): QuestionInfo {
  const question = fieldQuestionText(field, form);
  const header = fieldHeader(field, form);
  if (field.type === "multiselect") {
    return {
      question,
      header,
      options: field.options.map((option) => ({
        label: option.label,
        description: option.description ?? "",
      })),
      multiple: true,
    };
  }
  if (field.type === "string" && field.options && field.options.length > 0) {
    return {
      question,
      header,
      options: field.options.map((option) => ({
        label: option.label,
        description: option.description ?? "",
      })),
    };
  }
  if (field.type === "boolean") {
    return {
      question,
      header,
      options: [
        { label: "true", description: "" },
        { label: "false", description: "" },
      ],
    };
  }
  return { question, header, options: [] };
}

export function toV1Question(form: FormInfo): QuestionRequest {
  const fields = visibleFormFields(form);
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions:
      fields.length > 0
        ? fields.map((field) => toQuestionInfo(field, form))
        : [{ question: form.title, header: form.title, options: [] }],
  };
}

function optionValue(
  options: ReadonlyArray<{ value: string; label: string }> | undefined,
  label: string,
): string {
  return options?.find((option) => option.label === label)?.value ?? label;
}

function toFieldAnswer(
  field: FormField,
  answer: ReadonlyArray<string>,
): string | number | boolean | string[] | undefined {
  const first = answer[0];
  switch (field.type) {
    case "multiselect":
      return answer.map((label) => optionValue(field.options, label));
    case "string":
      return first === undefined ? undefined : optionValue(field.options, first);
    case "boolean":
      return first === undefined ? undefined : first.trim().toLowerCase() === "true";
    case "number":
    case "integer": {
      if (first === undefined) {
        return undefined;
      }
      const value = Number(first.trim());
      if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) {
        throw new Error(`Answer for "${field.key}" is not a valid ${field.type}`);
      }
      return value;
    }
    case "external":
      return undefined;
  }
}

/** Converts the per-question answers of the Telegram question UI back into a V2 form answer. */
export function toFormAnswer(
  form: FormInfo,
  answers: ReadonlyArray<ReadonlyArray<string>>,
): Record<string, string | number | boolean | string[]> {
  const result: Record<string, string | number | boolean | string[]> = {};
  visibleFormFields(form).forEach((field, index) => {
    const value = toFieldAnswer(field, answers[index] ?? []);
    if (value !== undefined) {
      result[field.key] = value;
    }
  });
  return result;
}

/** Splits V1 prompt parts into the V2 prompt text and file attachments. */
export function toV2PromptInput(parts: ReadonlyArray<TextPartInput | FilePartInput>): {
  text: string;
  files: Array<{ uri: string; name?: string }>;
} {
  const text = parts
    .filter((part): part is TextPartInput => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const files = parts
    .filter((part): part is FilePartInput => part.type === "file")
    .map((part) => ({ uri: part.url, ...(part.filename ? { name: part.filename } : {}) }));
  return { text, files };
}
