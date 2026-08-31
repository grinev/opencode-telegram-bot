---
name: opencode-telegram-bot PR #2 — bun fake-timers bug + decision pending
description: Detailed status of the bun port cleanup PR (#2) as of 2026-06-23. Includes the bun fake-timers bug investigation, my applied fix, and the open question on whether to upstream an issue/PR to oven-sh/bun.
type: project
originSessionId: 49f41e35-2ef0-45ae-b0cb-6a7dfc141169
status: awaiting-user-decision
---

# Opencode-telegram-bot PR #2 — bun port cleanup status (2026-06-23)

## TL;DR

PR #2 (`chore/docs-bun-port-cleanup`) of the `opencode-telegram-bot` fork was failing CI because `tests/app/services/scheduled-task-executor-service.test.ts` hung at 30s in `bun test`. Root cause was a bug in `bun:test`'s `useFakeTimers` implementation. I applied a workaround in the project's test shim + the 2 affected tests. **The whole suite is now green locally** (`bun run check` → 120/0). The PR is **uncommitted locally** — I held off because the previous turn raised the question of whether to also upstream the bug to `oven-sh/bun` and the user asked me to write this reminder before deciding.

## What was failing

The bot has a scheduled-task executor (`src/app/services/scheduled-task-executor-service.ts`) that polls every 2s with a 120-minute deadline. The test file has 14 tests; two of them needed to fast-forward fake time by many small steps (3600 for the timeout test, 8 for the startup-wait test). Both hung in CI at 30s.

The pre-existing shim at `opencode-telegram-bot/tests/helpers/vitest-shim.ts` provides a vitest-compatible layer over `bun:test`. Its `flushMicrotasks` helper used `await new Promise(r => setImmediate(r))` to drain the SUT's microtask chain.

## Root cause of the hang

The `setImmediate(resolve)` call inside `useFakeTimers` is registered as a fake timer. Accumulating ~4000 of these in a tight loop corrupts bun's internal fake-timer heap, and the next `jest.advanceTimersByTime()` call throws:

```
error: Fake timers are not active. Call useFakeTimers() first.
```

The bug is in `src/runtime/test_runner/timers/FakeTimers.zig` in `oven-sh/bun`. My best read of the source: `#active: bool` is only mutated by `activate()` and `deactivate()`, and `deactivate()` is only called by `useRealTimers()`. Since the SUT doesn't call `useRealTimers`, the flag must be getting flipped by memory corruption in the fake-timer heap. The exact mechanism would need ASAN to nail down (see "Camino B" below).

### Reproduction

Consistent at ~4000 iterations (not 3500 as I first thought — that was an early flakier estimate). 10/10 runs broke between iter 4297 and 4320.

The bug only triggers with the **combination** of:
- `setImmediate` registered as a fake timer (via `await new Promise(r => setImmediate(r))`)
- At least one pending `await`ed mock `Promise` (a `vi.fn().mockResolvedValue(...)`)

Without either of those, the loop runs to 5000+ iterations without error in ~50ms.

### Related bun issues (checked 2026-06-23, no duplicates)

| # | State | Title | Relevance |
|---|---|---|---|
| `#26493` | CLOSED (Apr 30 2026) | `feat(test): add advanceTimers option to useFakeTimers` | PR closed by inactivity >90d — bun team does not prioritize fake timers right now |
| `#16142` | OPEN (Jan 2025) | `Implement vi.useFakeTimers()` | Meta-issue, open 1.5y |
| `#26037` | OPEN (Jan 2026) | `Test using useFakeTimers hangs after simulating click event` | Different pattern (testing-library), but same area of runtime |
| `#26284`, `#25869` | CLOSED (Jan 2026) | `useFakeTimers and testing-library/react` | Fixed in 1.3.6 (setTimeout.clock + advanceTimersByTime(0) edge case) |
| `#1825` | OPEN | `bun test` | Meta-issue |

## The fix I applied (uncommitted, on branch `chore/docs-bun-port-cleanup`)

**Files modified:**

1. `tests/helpers/vitest-shim.ts` — `flushMicrotasks` and `advanceTimersByTimeAsync` now use `for (let i = 0; i < 5; i++) await Promise.resolve();` instead of `setImmediate` flush. Drains the same microtask chains without leaking into the fake-timer heap. 5 turns is enough for the typical `enqueueTask().then(async () => ...).then(syncState).then(await sendText(...))` chains in this codebase.

2. `tests/app/services/scheduled-task-executor-service.test.ts`:
   - **Test 5** (`fails when execution stays busy beyond the bot polling deadline`): restored to the pre-merge `accelerateTime` approach (monkey-patches `globalThis.setTimeout` and `Date.now` to use `queueMicrotask` for setTimeout callbacks and a custom fake clock). No fake timers needed → avoids the bug entirely. Added `{ timeout: 30000 }` per-test config (was there before, lost in earlier edits).
   - **Test 6** (`waits through startup before the server registers the session as active`): same `accelerateTime` approach. The pre-merge `vi.advanceTimersByTimeAsync(12000)` also hung in CI for the same reason.

**Verification:** `bun run check` → 120 files, 120 pass, 0 fail. (Baseline without my fix hangs at the 120s timeout on the original test 6.) No regressions in any of the 9 other files that use `advanceTimersByTime` (verified by stashing my changes and re-running).

## Repo state (right now)

- Branch: `chore/docs-bun-port-cleanup`
- Last commit: `35e470f fix(test): keep runAllTimersAsync a microtask flush, do not call bun's runAllTimers`
- 2 files modified, uncommitted:
  - `tests/helpers/vitest-shim.ts`
  - `tests/app/services/scheduled-task-executor-service.test.ts`
- PR #2 lives against `develop` of `primigenum/opencode-telegram-bot`
- No commits/pushes done this turn

## The decision: upstream or not?

I proposed 3 paths; the user said "I'll see it tomorrow", so this is the open question.

**Camino A — Detailed issue only** (~2-4h, value immediately)
- Read `FakeTimers.zig` deeply, propose a precise root-cause hypothesis with code evidence
- Submit a much more technical issue than the draft I have
- Pros: documentation is permanent
- Cons: bun team may not fix it (precedent: #26493)

**Camino B — Full PR to oven-sh/bun** (~8-15h, uncertain outcome)
- Build env setup (zig 0.x, ninja, JSC build, ~5GB disk) on this Fedora 44
- ASAN debug run to confirm corruption location
- Zig fix + regression test (`test/regression/issue/<num>.test.ts`)
- `gh pr create` against `oven-sh/bun`
- Pros: real contribution
- Cons: may sit unreviewed (precedent: #26493). Also: root cause might not be in the heap at all (could be GC interaction), in which case re-scope is needed

**Camino C (my recommendation) — Issue + draft PR** (compromise)
- Do A (better issue)
- And also open a draft PR with the best hypothesis fix; bun maintainers have the build env, can validate in minutes
- Pros: low marginal cost, leaves door open
- Cons: needs enough investigation upfront to write a plausible fix without compiling locally

The issue draft I have is in **`/tmp/bun-issue.md`** (105 lines, English, with minimal repro, source dive, workaround, question to bun team). It's the base for any of the 3 paths.

## Files I touched in `/tmp/` (cleanup before commit, retain as evidence)

- `/tmp/bun-issue.md` — issue draft (English, ready to submit)
- `/tmp/repro-test-5.ts` — first SUT pattern repro
- `/tmp/stress-advance.ts` — proves advance alone is fast
- `/tmp/measure-advance.ts` — proves single big-advance is fast
- `/tmp/stress-timer.ts` — 1000-iter baseline OK
- `/tmp/stress-sut.ts` — full SUT pattern, breaks at ~3500
- `/tmp/stress-sut-2.ts` — with try/catch + console logging
- `/tmp/stress-sut-3.ts` — with getTimerCount logging (always 0)
- `/tmp/stress-sut-shim.ts` — with shim-style flow (breaks ~4300)
- `/tmp/stress-find.ts` — finds exact break point
- `/tmp/one-big-advance.ts` — single advance(7.2M) eats real time
- `/tmp/progress.ts` — proves Date.now() jumps after advance (not what shim restores)
- `/tmp/no-flush.ts` — proves the issue is the setImmediate flush, not the advance
- `/tmp/with-flush.ts` — same with setImmediate, breaks
- `/tmp/just-immediate.ts` / `/tmp/just-immediate-2.ts` — pure setImmediate repro
- `/tmp/fix-test.ts` — proves the fix (test 5 + test 6 patterns, 3600 iters OK)
- `/tmp/fix-shim.ts` — same with shim-style
- `/tmp/minimal-repro.ts` — minimal setImmediate+advance loop
- `/tmp/full-repro.ts` — full SUT pattern with mocks
- `/tmp/test-queueMicrotask.ts` — proves queueMicrotask is safe
- `/tmp/test-setTimeout0.ts` — proves setTimeout(0) is safe (awaited)
- `/tmp/test-immediate-unawaited.ts` — proves setImmediate is safe when NOT awaited

(If the user wants a clean /tmp, can `rm /tmp/repro-*.ts /tmp/stress-*.ts /tmp/test-*.ts /tmp/fix-*.ts /tmp/minimal-*.ts /tmp/full-*.ts /tmp/measure-*.ts /tmp/no-flush.ts /tmp/with-flush.ts /tmp/one-big-advance.ts /tmp/progress.ts` — keep `/tmp/bun-issue.md` for now.)

## Bun source references (already webfetched this session)

- `src/runtime/test_runner/timers/FakeTimers.zig` — main fake-timer logic. `useFakeTimers`/`useRealTimers`/`advanceTimersByTime`/`executeUntil`/`fire`/`isActive`/`#active` flag.
- `src/jsc/bindings/JSMockFunction.cpp` — `JSMock__jsSetSystemTime` (just sets `globalObject->overridenDateNow`, doesn't touch `#active`).
- `src/runtime/test_runner/jest.zig` and `jest.rs` — bindings that expose `setSystemTime` to JS.

The cleanest suspect for the fix location is the `TimerHeap` (where `setImmediate` differs from `setTimeout`), accessed at `bun.api.Timer.TimerHeap` in bun's `Timer.zig` (not fetched yet — would need to do that for Camino B).

## What to do tomorrow (proposed)

1. Decide: A, B, or C.
2. If A or C: review the draft in `/tmp/bun-issue.md`, tweak if needed, submit via `gh issue create --repo oven-sh/bun --title "..." --body-file /tmp/bun-issue.md`.
3. If B or C: I need to (a) clone `oven-sh/bun`, (b) set up the build env on this Fedora 44, (c) run with ASAN to confirm the heap corruption mechanism. This will eat 1-2h of setup before the real work.
4. In parallel: commit and push the local fix to PR #2 (still uncommitted). This is independent of the bun upstream decision.

## User's standing preferences to remember

- `/agent bypass` is active for this session
- Spanish responses, English in code/comments
- Never commit without explicit ask
- "Ve subiendo los tests, el runner los corre antes, checkea directamente en el ci y ya" — push to CI, check there
- Avoid `sudo`; use `/tmp/opencode/<name>.sh` scripts
- No subagents without "profundo" trigger

`last_reminded: 2026-06-23`
