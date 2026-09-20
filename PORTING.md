# Port to OpenCode v2

This fork migrates the bot from OpenCode v1 to **OpenCode v2** (tested against
server v2.0.10 / v2.0.11).

## TL;DR

Upstream v0.25.3 already targeted the v2-generated SDK (`@opencode-ai/sdk/v2`),
so this is a **migration + drift verification**, not a rewrite. The SDK is bumped
to `@opencode-ai/sdk@^1.18.31`; the bot stays on `client.v2.*`, uncovered routes
go through a thin `directApi()` bridge, and SSE events are translated from v2
shapes back to the v1-shaped aggregator.

## What changed

- `src/opencode/client.ts` — `createOpencodeClient` from `@opencode-ai/sdk/v2`;
  added `getServerInfo()`, `getBusySessionStatuses()`, `listSessions()`,
  `getSessionMessages()`, `sendSessionPrompt()`, `directApi()`.
- `src/opencode/catalog.ts` (new) — v2 serves providers and models from separate
  endpoints (`/api/provider`, `/api/model`); `fetchModelCatalog()` joins them.
- `src/opencode/events.ts` — SSE bridge translating v2 events
  (`{id, created, type, data}`) into the v1 `{type, properties}` shape the
  summary aggregator still speaks.
- `src/app/services/**` — session-scoped questions/permissions, model/agent
  switching ahead of prompts, and several v1→v2 shape fixes surfaced by tests.

## Route drift v1 → v2 (empirical)

| v1 | v2 | handled by |
|---|---|---|
| `global.health` | `GET /api/info` | `getServerInfo()` |
| `project.list` → `{id, worktree, name}` | `GET /api/project` → `[{id, canonical, time}]` | `directApi` |
| `config.providers` (nested models) | `GET /api/provider` + `GET /api/model` | `catalog.ts` |
| `session.status` (map) | `session.active()` (running only) | `getBusySessionStatuses()` |
| `session.abort` → bool | `POST …/interrupt` → 204 | poll status |
| `session.update` → object | `PATCH …/{id}` → 204 | absence of error = ok |
| `session.delete` / `session.fork` / `session.command` | SDK has none; raw routes exist | `directApi` |
| `session.prompt {parts, agent, model}` | `POST …/prompt` flat `{text, files?}` | `sendSessionPrompt()` |
| `session.promptAsync` | `prompt` + `POST …/wait` + `messages` | schedule-parser |
| global `question.*` / `permission.*` | session-scoped only | `currentSession.id` |
| `permission.reply {reply}` | adds `once`/`always`/`reject` + optional `message` | enum |
| `session.summarize` | `POST …/compact` (session model) | `compact({sessionID})` |
| `session.revert` | `…/revert/{stage,clear,commit}` | `revert.stage()` |
| nested `session.messages` | flat `{type:"user",text}` / `{type:"assistant",content}` | `getSessionMessages()` |
| global `mcp.*` | no v2-mcp in SDK; raw routes exist | `directApi` |
| `app.agents` | `GET /api/agent` → `{location, data}` | `name ?? id` |
| `todowrite` / `todo.updated` | removed intentionally | not ported |

## Decisions

1. **SDK stays `@opencode-ai/sdk@^1.18.31`**, namespace `client.v2.*`. The
   official `@opencode/sdk@2.x` is a different (effect-style) API — a full
   rewrite; the top-level `client.session.*` of 1.18.31 are v1 shapes (dead
   against a local v2 server).
2. **`directApi()` fills SDK gaps** instead of forking the SDK — one file, an
   explicit list, easy to drop once the SDK catches up.
3. **Events are bridged, not rewritten** — the 2000-line summary aggregator keeps
   speaking v1 types; translation lives in one place (`events.ts`).
4. **Questions/permissions are session-scoped only** — no global routes in v2.
5. **Prompts always go through `sendSessionPrompt()`** — v2 rejects agent/model in
   the prompt body, so switch first; body is flat (SDK `{prompt:{…}}` → 400).
6. **Server password is mandatory** — v2 `serve` without
   `OPENCODE_SERVER_PASSWORD` generates a random one to stdout and returns 401.
7. **Todos are not ported** — upstream removed them intentionally.

## Verification

- `npm run build`, `npm run lint`, `npm run typecheck` — clean.
- `npm test` — 1848 passed / 161 files.
- Live Telegram smoke: prompts stream, tool calls / file diffs render, agent /
  model / context switching fixed.
