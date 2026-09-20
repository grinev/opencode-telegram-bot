import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { FilePartInput, PromptInputFileAttachment } from "@opencode-ai/sdk/v2";
import { config } from "../config.js";

const getAuth = () => {
  if (!config.opencode.password) {
    return undefined;
  }
  const credentials = `${config.opencode.username}:${config.opencode.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

export const opencodeClient = createOpencodeClient({
  baseUrl: config.opencode.apiUrl,
  headers: config.opencode.password ? { Authorization: getAuth() } : undefined,
});

// v2 local-server API namespaces (opencode v2 serves /api/*; the top-level
// client.session/question/... namespaces are v1-shaped and dead against v2).
export const opencodeV2 = opencodeClient.v2;

function authHeaders(): Record<string, string> {
  const auth = getAuth();
  return auth ? { Authorization: auth } : {};
}

// SDK errors are plain objects, not Error instances — normalize once.
export function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string" && error.length > 0) {
    return new Error(error);
  }
  try {
    return new Error(`${fallback}: ${JSON.stringify(error)}`);
  } catch {
    return new Error(fallback);
  }
}

// Minimal raw fetch for /api routes missing from @opencode-ai/sdk/v2
// (info, project, session update/delete/fork/command, forms).
// Returns { data, error } like the SDK so call sites read uniformly.
export async function directApi<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  init?: { signal?: AbortSignal },
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const headers: Record<string, string> = { ...authHeaders() };
    const request: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(body);
    }
    if (init?.signal) {
      request.signal = init.signal;
    }
    const response = await fetch(`${config.opencode.apiUrl}${path}`, request);
    if (!response.ok) {
      return { data: null, error: new Error(`HTTP ${response.status} for ${method} ${path}`) };
    }
    if (response.status === 204) {
      return { data: null, error: null };
    }
    const text = await response.text();
    return { data: (text ? JSON.parse(text) : null) as T, error: null };
  } catch (error) {
    return { data: null, error: toError(error, `Request failed for ${method} ${path}`) };
  }
}

// Replaces the v1 global.health endpoint (gone in v2): a 200 response means healthy.
export interface ServerInfo {
  version: string;
  pid: number;
  urls: string[];
  paths: { tmp: string };
}

export function getServerInfo(init?: { signal?: AbortSignal }) {
  return directApi<ServerInfo>("GET", "/api/info", undefined, init);
}

// v2 has no session.status endpoint. The closest equivalent is
// session.active() (running drains only). Map it onto the v1 status shape:
// present = busy, absent = terminal/not-found.
export async function getBusySessionStatuses(): Promise<{
  data: Record<string, { type: string }> | undefined;
  error: Error | null;
}> {
  const { data, error } = await opencodeV2.session.active();
  if (error || !data) {
    return { data: undefined, error: toError(error, "No active session data received") };
  }
  const activeMap: Record<string, unknown> =
    data && typeof data === "object" && "data" in data && data.data !== undefined
      ? (data.data as Record<string, unknown>)
      : (data as unknown as Record<string, unknown>);
  const statuses: Record<string, { type: string }> = {};
  for (const sessionID of Object.keys(activeMap)) {
    statuses[sessionID] = { type: "busy" };
  }
  return { data: statuses, error: null };
}

export interface SessionListEntry {
  id: string;
  title: string;
  directory: string;
  time: { created: number; updated: number };
  parentID?: string | undefined;
}

export interface PromptSendOptions {
  sessionID: string;
  text: string;
  files?: PromptInputFileAttachment[];
  agent?: string;
  model?: { providerID: string; modelID: string; variant?: string };
}

// v2 files ride as {uri, name?}; v1 file parts carry {url, filename}.
export function toV2FileAttachment(part: FilePartInput): PromptInputFileAttachment {
  const attachment: PromptInputFileAttachment = { uri: part.url };
  if (part.filename !== undefined) {
    attachment.name = part.filename;
  }
  return attachment;
}

// v2 admits one input per prompt call; agent/model are switched on the
// session first (v1 accepted them per-prompt). Mirrors promptAsync semantics:
// admission only, the result arrives via the event subscription.
export async function sendSessionPrompt(
  options: PromptSendOptions,
): Promise<{ data: unknown; error: Error | null }> {
  try {
    if (options.agent) {
      const { error } = await opencodeV2.session.switchAgent({
        sessionID: options.sessionID,
        agent: options.agent,
      });
      if (error) {
        return { data: null, error: toError(error, "Failed to switch agent") };
      }
    }
    if (options.model?.providerID && options.model?.modelID) {
      const modelRef: { providerID: string; id: string; variant?: string } = {
        providerID: options.model.providerID,
        id: options.model.modelID,
      };
      if (options.model.variant) {
        modelRef.variant = options.model.variant;
      }
      const { error } = await opencodeV2.session.switchModel({
        sessionID: options.sessionID,
        model: modelRef,
      });
      if (error) {
        return { data: null, error: toError(error, "Failed to switch model") };
      }
    }
    const promptBody: { text: string; files?: PromptInputFileAttachment[] } = {
      text: options.text,
    };
    if (options.files && options.files.length > 0) {
      promptBody.files = options.files;
    }
    // NOTE: sent raw, not via SDK — SDK 1.18.31 wraps the body as
    // {prompt:{...}} but server 2.0.10 expects the PromptInput flat.
    const { data, error } = await directApi(
      "POST",
      `/api/session/${options.sessionID}/prompt`,
      promptBody,
    );
    if (error) {
      return { data: null, error };
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error: toError(error, "Failed to send prompt") };
  }
}

export interface NormalizedMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  created: number;
}

// Normalized wrapper over v2 session.messages. v2 messages are flat
// ({type:"user",text} / {type:"assistant",content:[{type:"text",text}]});
/// everything else (system, compaction, shell, ...) is skipped.
export async function getSessionMessages(
  sessionID: string,
  limit?: number,
): Promise<{ data: NormalizedMessage[] | null; error: Error | null }> {
  const params: { sessionID: string; limit?: number } =
    limit !== undefined ? { sessionID, limit } : { sessionID };
  const { data, error } = await opencodeV2.session.messages(params);
  if (error || !data) {
    return { data: null, error: toError(error, "No message data received") };
  }
  const messages: NormalizedMessage[] = [];
  for (const message of data.data) {
    if (message.type === "user") {
      if (message.text.trim().length > 0) {
        messages.push({
          id: message.id,
          role: "user",
          text: message.text,
          created: message.time.created,
        });
      }
    } else if (message.type === "assistant") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => (part as { text: string }).text)
        .join("")
        .trim();
      if (text.length > 0) {
        messages.push({ id: message.id, role: "assistant", text, created: message.time.created });
      }
    }
  }
  return { data: messages, error: null };
}

// Normalized wrapper over v2 session.list (envelope {location, data:{data, cursor}},
// v2 SessionV2Info carries directory under location). roots=true keeps top-level only.
export async function listSessions(params?: {
  directory?: string;
  limit?: number;
  roots?: boolean;
}): Promise<{ data: SessionListEntry[] | null; error: Error | null }> {
  const listParams: { directory?: string; limit?: number; order: "desc" } = {
    order: "desc",
  };
  if (params?.directory !== undefined) {
    listParams.directory = params.directory;
  }
  if (params?.limit !== undefined) {
    listParams.limit = params.limit;
  }
  const { data, error } = await opencodeV2.session.list(listParams);
  if (error || !data) {
    return { data: null, error: toError(error, "No session list received from server") };
  }
  let items: SessionListEntry[] = data.data.map((session) => ({
    id: session.id,
    title: session.title,
    directory: session.location.directory,
    time: { created: session.time.created, updated: session.time.updated },
    parentID: session.parentID,
  }));
  if (params?.roots) {
    items = items.filter((session) => !session.parentID);
  }
  return { data: items, error: null };
}
