import type { OpencodeClient } from "@opencode-ai/sdk/v2";

// The bot only needs this subset of the legacy SDK. Both transports expose the
// same data contract so Telegram handlers do not need API-version branches.
type ApiMethod = (...args: never[]) => unknown;
type CompatibleMethod<F extends ApiMethod> = (...args: Parameters<F>) => Promise<{
  data?: Extract<Awaited<ReturnType<F>>, { data: unknown }>["data"];
  error?: unknown;
}>;
type Resource<T, K extends keyof T> = {
  [P in K]: T[P] extends ApiMethod ? CompatibleMethod<T[P]> : never;
};

export interface BotOpenCodeClient {
  global: Resource<OpencodeClient["global"], "health"> & {
    event(options?: {
      signal?: AbortSignal;
      onActivity?: () => void;
    }): Promise<{ stream: AsyncGenerator<unknown> }>;
  };
  event: {
    subscribe(
      input?: { directory?: string },
      options?: { signal?: AbortSignal; onActivity?: () => void },
    ): Promise<{ stream: AsyncGenerator<unknown> }>;
  };
  session: Resource<
    OpencodeClient["session"],
    | "list"
    | "create"
    | "get"
    | "update"
    | "delete"
    | "status"
    | "messages"
    | "prompt"
    | "promptAsync"
    | "abort"
    | "fork"
    | "revert"
    | "summarize"
    | "diff"
  > & {
    command(
      ...args: Parameters<OpencodeClient["session"]["command"]>
    ): Promise<{ data?: unknown; error?: unknown }>;
  };
  project: Resource<OpencodeClient["project"], "list">;
  config: Resource<OpencodeClient["config"], "providers">;
  app: Resource<OpencodeClient["app"], "agents">;
  command: Resource<OpencodeClient["command"], "list">;
  mcp: Resource<OpencodeClient["mcp"], "status" | "connect" | "disconnect">;
  question: Resource<OpencodeClient["question"], "list" | "reply" | "reject">;
  permission: Resource<OpencodeClient["permission"], "list" | "reply">;
  path?: {
    get?: () => Promise<{ data?: { home?: string; state?: string } | undefined; error?: unknown }>;
  };
}
