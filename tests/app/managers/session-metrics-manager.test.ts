import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionMetricsManager } from "../../../src/app/managers/session-metrics-manager.js";
import { deferred } from "../../helpers/deferred.js";

const mocks = vi.hoisted(() => ({
  messages: vi.fn(),
  get: vi.fn(),
  diff: vi.fn(),
  limit: vi.fn(),
  waitForLimit: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: { session: { messages: mocks.messages, get: mocks.get, diff: mocks.diff } },
}));
vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: () => ({ providerID: "provider", modelID: "model" }),
}));
vi.mock("../../../src/app/services/model-context-limit-service.js", () => ({
  DEFAULT_CONTEXT_LIMIT: 200_000,
  getModelContextLimit: mocks.limit,
  waitForModelContextLimit: mocks.waitForLimit,
}));

const session = { id: "session", directory: "D:/repo" };
const files = [{ file: "src/a.ts", additions: 2, deletions: 1 }];

function assistant(created: number, input: number, cacheRead: number, cost: number, summary = false) {
  return {
    info: { role: "assistant", summary, time: { created }, tokens: { input, cache: { read: cacheRead } }, cost },
  };
}

describe("session metrics", () => {
  let metrics: SessionMetricsManager;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.messages.mockResolvedValue({ data: [] });
    mocks.get.mockResolvedValue({ data: {} });
    mocks.diff.mockResolvedValue({ data: [] });
    mocks.limit.mockResolvedValue(200_000);
    mocks.waitForLimit.mockResolvedValue(null);
    metrics = new SessionMetricsManager();
  });

  it("takes the latest usable context from bounded history and session-wide cost", async () => {
    mocks.messages.mockResolvedValue({
      data: [
        assistant(200, 300, 100, 0.5),
        assistant(100, 1500, 100, 1),
        assistant(300, 0, 0, 0),
        assistant(400, 900, 100, 2, true),
      ],
    });
    mocks.get.mockResolvedValue({ data: { cost: 12.5 } });
    mocks.diff.mockResolvedValue({ data: files });
    await metrics.prepare(session);

    expect(metrics.getContextInfo()).toEqual({ tokensUsed: 400, tokensLimit: 200_000 });
    expect(await metrics.snapshot(session)).toMatchObject({ tokensUsed: 400, cost: 12.5, changedFiles: files });
    expect(mocks.messages).toHaveBeenCalledWith({
      sessionID: session.id, directory: session.directory, limit: 100,
    });
  });

  it("keeps last-good values on failure without applying them to a different selection", async () => {
    mocks.diff.mockResolvedValueOnce({ data: files });
    mocks.get.mockResolvedValueOnce({ data: { cost: 12.5 } });
    await metrics.prepare(session);
    mocks.messages.mockRejectedValue(new Error("offline"));
    mocks.get.mockResolvedValue({ error: "offline" });
    mocks.diff.mockResolvedValue({ error: "offline" });

    expect(await metrics.snapshot(session)).toMatchObject({ tokensUsed: 0, cost: 12.5, changedFiles: files });
    expect(await metrics.snapshot({ ...session, id: "other" })).toMatchObject({
      tokensUsed: null, cost: null, changedFiles: null,
    });
  });

  it("distinguishes a successful empty diff from a failed read", async () => {
    await metrics.prepare(session);
    metrics.onSessionDiff(session.id, files);
    expect((await metrics.snapshot(session)).changedFiles).toEqual([]);
    mocks.diff.mockResolvedValue({ error: "offline" });
    expect((await metrics.snapshot(session)).changedFiles).toEqual([]);
  });

  it("uses authoritative SSE files if newer than a pending snapshot read", async () => {
    await metrics.prepare(session);
    const pending = deferred<{ data: typeof files }>();
    mocks.diff.mockReturnValueOnce(pending.promise);
    const snapshot = metrics.snapshot(session);
    metrics.onSessionDiff(session.id, []);
    pending.resolve({ data: files });
    expect((await snapshot).changedFiles).toEqual([]);
  });

  it("keeps keyboard values live, refreshes after compaction, and ignores an old session", async () => {
    const notify = vi.fn();
    metrics.setOnKeyboardUpdate(notify);
    await metrics.prepare(session, { created: true });
    expect(mocks.messages).not.toHaveBeenCalled();
    metrics.onTokens("other", 12_000);
    metrics.onTokens(session.id, 8_000);
    expect(notify).toHaveBeenLastCalledWith(8_000, 200_000);
    mocks.messages.mockResolvedValue({ data: [assistant(100, 200, 100, 0)] });
    await metrics.onSessionCompacted(session.id, session.directory);
    expect(notify).toHaveBeenLastCalledWith(300, 200_000);
  });

  it("keeps a last-good snapshot cost without adding live completion cost to it again", async () => {
    mocks.get.mockResolvedValueOnce({ data: { cost: 1 } });
    await metrics.prepare(session);
    mocks.get.mockResolvedValueOnce({ data: { cost: 2 } });
    expect((await metrics.snapshot(session)).cost).toBe(2);
    expect((await metrics.snapshot(session)).cost).toBe(2);
    metrics.onCostUpdate(session.id, 1);
    expect((await metrics.snapshot(session)).cost).toBe(2);
  });

  it.each([1, 1.2])("uses the completion during a snapshot when the server returns $%s", async (cost) => {
    mocks.get.mockResolvedValueOnce({ data: { cost: 1 } });
    await metrics.prepare(session);
    const pending = deferred<{ data: { cost: number } }>();
    mocks.get.mockReturnValueOnce(pending.promise);
    const snapshot = metrics.snapshot(session);
    metrics.onCostUpdate(session.id, 0.2);
    pending.resolve({ data: { cost } });
    expect((await snapshot).cost).toBeCloseTo(1.2);
  });

  it("corrects the keyboard when the selected model's catalog limit arrives", async () => {
    const pending = deferred<number>();
    mocks.waitForLimit.mockReturnValue(pending.promise);
    const notify = vi.fn();
    metrics.setOnKeyboardUpdate(notify);
    await metrics.prepare(session, { created: true });
    expect(notify).toHaveBeenLastCalledWith(0, 200_000);
    pending.resolve(1_000_000);
    await vi.waitFor(() => expect(notify).toHaveBeenLastCalledWith(0, 1_000_000));
  });

  it("does not commit history from an attach that was superseded", async () => {
    const pending = deferred<{ data: ReturnType<typeof assistant>[] }>();
    mocks.messages.mockReturnValueOnce(pending.promise);
    const old = metrics.prepare(session);
    await metrics.prepare({ ...session, id: "other" }, { created: true });
    pending.resolve({ data: [assistant(100, 200, 100, 0)] });
    await old;
    expect(metrics.getContextInfo()?.tokensUsed).toBe(0);
  });
});
