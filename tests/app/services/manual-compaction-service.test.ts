import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { ManualCompactionService } from "../../../src/app/services/manual-compaction-service.js";

const mocked = vi.hoisted(() => ({
  version: "v2",
  start: vi.fn(),
  inspect: vi.fn(),
  waitForIdle: vi.fn(),
  withdraw: vi.fn(),
  interrupt: vi.fn(),
  summarize: vi.fn(),
  messages: vi.fn(),
  message: vi.fn(),
  status: vi.fn(),
  abort: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  get opencodeServerVersion() {
    return mocked.version;
  },
  opencodeClient: {
    session: {
      summarize: mocked.summarize,
      messages: mocked.messages,
      message: mocked.message,
      status: mocked.status,
      abort: mocked.abort,
    },
  },
  opencodeV2Client: {
    session: {
      manualCompaction: {
        start: mocked.start,
        inspect: mocked.inspect,
        waitForIdle: mocked.waitForIdle,
        withdraw: mocked.withdraw,
        interrupt: mocked.interrupt,
      },
    },
  },
}));

const SESSION = { id: "session", directory: "/project", title: "Task" };
const MODEL = { providerID: "provider", modelID: "model" };
const COMPACTED: Event = {
  id: "event",
  type: "session.compacted",
  properties: { sessionID: SESSION.id },
};

function signal(id: string, cancelled = false): Event {
  return {
    id: "event",
    type: "manual_compaction.changed",
    properties: {
      sessionID: SESSION.id,
      inputID: id,
      phase: cancelled ? "cancelled" : "delivered",
    },
  } as unknown as Event;
}

function newAttempt() {
  const service = new ManualCompactionService();
  const selected = { id: SESSION.id };
  const outcome = vi.fn().mockResolvedValue(undefined);
  const newOutcome = vi.fn().mockResolvedValue(undefined);
  const fallback = vi.fn().mockResolvedValue({ finish: newOutcome });
  const notifySuccess = vi.fn().mockResolvedValue(undefined);
  const releaseInteractions = vi.fn();
  service.configurePresentation({
    isSelected: (id) => selected.id === id,
    openProgress: fallback,
    notifySuccess,
    releaseInteractions,
  });
  const attempt = service.reserve(SESSION)!;
  void service.showProgress(attempt, async () => ({ finish: outcome }));
  return {
    service,
    selected,
    attempt,
    outcome,
    newOutcome,
    fallback,
    notifySuccess,
    releaseInteractions,
  };
}

describe("manual compaction service", () => {
  beforeEach(() => {
    mocked.version = "v2";
    mocked.start.mockResolvedValue({ data: "msg_compaction" });
    mocked.inspect.mockResolvedValue({ data: "pending" });
    mocked.waitForIdle.mockResolvedValue({ data: true });
    mocked.withdraw.mockResolvedValue({ data: true });
    mocked.interrupt.mockResolvedValue({ data: true });
    mocked.status.mockResolvedValue({ data: {} });
  });

  it("locks before admission and uses the returned identity, not the provisional one", async () => {
    const { service, attempt, outcome } = newAttempt();
    expect(service.isActive(SESSION.id)).toBe(true);
    expect(service.reserve(SESSION)).toBeUndefined();

    await service.start(attempt, MODEL);
    expect(mocked.inspect).toHaveBeenCalledWith(SESSION.id, "msg_compaction", undefined);
    expect(service.isActive(SESSION.id)).toBe(true);
    expect(outcome).not.toHaveBeenCalled();

    service.onEvent(signal("msg_unrelated", true), SESSION.id);
    expect(service.isActive(SESSION.id)).toBe(true);
    mocked.inspect.mockResolvedValue({ data: "success" });
    service.onEvent(COMPACTED, SESSION.id);
    service.onEvent(COMPACTED, SESSION.id);

    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("success"));
    expect(outcome).toHaveBeenCalledOnce();
    expect(service.isActive(SESSION.id)).toBe(false);
  });

  it("checks the admitted id when the completion arrives before the admission reply", async () => {
    const { service, attempt, outcome } = newAttempt();
    let admitted!: (result: { data: string }) => void;
    mocked.start.mockReturnValue(
      new Promise((resolve) => {
        admitted = resolve;
      }),
    );
    const starting = service.start(attempt, MODEL);
    service.onEvent(COMPACTED, SESSION.id);
    mocked.inspect.mockResolvedValue({ data: "success" });
    admitted({ data: "msg_compaction" });
    await starting;
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("success"));
  });

  it("withdraws a pending compaction without interrupting the session execution", async () => {
    const { service, attempt, outcome } = newAttempt();
    await service.start(attempt, MODEL);
    mocked.withdraw.mockImplementation(async () => {
      mocked.inspect.mockResolvedValue({ data: "missing" });
      service.onEvent(signal("msg_compaction", true), SESSION.id);
      return { data: true };
    });
    expect(await service.cancel(attempt)).toBe(true);
    expect(mocked.withdraw).toHaveBeenCalledWith(SESSION.id, "msg_compaction");
    expect(mocked.interrupt).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("interrupted"));
  });

  it("reconciles an acknowledged withdrawal when the cancellation event was lost", async () => {
    const { service, attempt, outcome } = newAttempt();
    await service.start(attempt, MODEL);
    mocked.withdraw.mockImplementation(async () => {
      mocked.inspect.mockResolvedValue({ data: "missing" });
      return { data: true };
    });
    mocked.waitForIdle
      .mockResolvedValueOnce({ error: new Error("stream was down") })
      .mockResolvedValue({ data: true });

    const cancellation = service.cancel(attempt);
    await vi.waitFor(() => expect(mocked.waitForIdle).toHaveBeenCalledOnce());
    expect(service.isActive(SESSION.id)).toBe(true);
    expect(outcome).not.toHaveBeenCalled();
    service.reconcile();

    await expect(cancellation).resolves.toBe(true);
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("interrupted"));
    expect(mocked.interrupt).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "interrupts a promoted request even if withdrawal failed (%s)",
    async (withdrawalFailed) => {
      const { service, attempt, outcome } = newAttempt();
      await service.start(attempt, MODEL);
      mocked.withdraw.mockImplementation(async () => {
        mocked.inspect.mockResolvedValue({ data: "running" });
        return withdrawalFailed ? { error: new Error("no longer in inbox") } : { data: true };
      });
      mocked.interrupt.mockImplementation(async () => {
        mocked.inspect.mockResolvedValue({ data: "interrupted" });
        return { data: true };
      });
      expect(await service.cancel(attempt)).toBe(true);
      expect(mocked.interrupt).toHaveBeenCalledWith(SESSION.id);
      await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("interrupted"));
    },
  );

  it("does not unlock on a transient missing read while V2 promotes compaction", async () => {
    const { service, attempt, outcome } = newAttempt();
    await service.start(attempt, MODEL);
    mocked.inspect.mockResolvedValue({ data: "missing" });
    service.onEvent(signal("msg_compaction"), SESSION.id);
    await vi.waitFor(() => expect(mocked.inspect).toHaveBeenCalledTimes(3));
    expect(service.isActive(SESSION.id)).toBe(true);
    expect(outcome).not.toHaveBeenCalled();

    service.reconcile();
    await vi.waitFor(() => expect(mocked.inspect).toHaveBeenCalledTimes(5));
    expect(service.isActive(SESSION.id)).toBe(true);
    mocked.inspect.mockResolvedValue({ data: "success" });
    service.onEvent(COMPACTED, SESSION.id);
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("success"));
  });

  it("keeps progress open after a refused cancellation", async () => {
    const { service, attempt, outcome } = newAttempt();
    await service.start(attempt, MODEL);
    mocked.withdraw.mockResolvedValue({ error: new Error("not withdrawn") });
    expect(await service.cancel(attempt)).toBe(false);
    expect(service.isActive(SESSION.id)).toBe(true);
    expect(outcome).not.toHaveBeenCalled();
  });

  it("notifies a detached success without editing its original progress", async () => {
    const { service, attempt, selected, outcome, notifySuccess } = newAttempt();
    await service.start(attempt, MODEL);
    service.detach(SESSION.id);
    selected.id = "different";
    mocked.inspect.mockResolvedValue({ data: "success" });
    service.onEvent(COMPACTED, SESSION.id);
    await vi.waitFor(() => expect(notifySuccess).toHaveBeenCalledWith(SESSION));
    expect(outcome).not.toHaveBeenCalled();
  });

  it("uses fresh progress upon reattachment and avoids detached or duplicate output", async () => {
    const { service, attempt, selected, fallback, outcome, newOutcome, notifySuccess } =
      newAttempt();
    await service.start(attempt, MODEL);
    service.detach(SESSION.id);
    selected.id = "different";
    service.select(selected.id);
    selected.id = SESSION.id;
    service.select(SESSION.id);
    service.select(SESSION.id);
    mocked.inspect.mockResolvedValue({ data: "success" });
    service.onEvent(COMPACTED, SESSION.id);
    await vi.waitFor(() => expect(newOutcome).toHaveBeenCalledWith("success"));
    expect(fallback).toHaveBeenCalledOnce();
    expect(outcome).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("keeps pending compaction across reconnect, then shows unknown when its result is unverifiable", async () => {
    const { service, attempt, outcome } = newAttempt();
    await service.start(attempt, MODEL);
    service.reconcile();
    await vi.waitFor(() => expect(mocked.inspect).toHaveBeenCalledTimes(2));
    expect(service.isActive(SESSION.id)).toBe(true);
    mocked.inspect.mockResolvedValue({ data: "running" });
    service.onEvent(signal("msg_compaction"), SESSION.id);
    await vi.waitFor(() => expect(mocked.inspect).toHaveBeenCalledTimes(3));
    mocked.inspect.mockResolvedValue({ data: "missing" });
    service.reconcile();
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("unknown"));
  });

  it("does not recover a durable V2 compaction on a confirmed server restart", async () => {
    const { service, attempt, outcome, releaseInteractions } = newAttempt();
    await service.start(attempt, MODEL);
    service.serverInterrupted();
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("interrupted"));
    expect(mocked.withdraw).not.toHaveBeenCalled();
    expect(releaseInteractions).not.toHaveBeenCalled();
  });

  it("does not interpret V1 true or an automatic summary as success for manual compaction", async () => {
    mocked.version = "v1";
    mocked.messages.mockResolvedValueOnce({ data: [] }).mockResolvedValue({
      data: [
        { info: { id: "auto" }, parts: [{ type: "compaction", auto: true }] },
        { info: { role: "assistant", summary: true, parentID: "auto", finish: "stop" }, parts: [] },
      ],
    });
    mocked.summarize.mockResolvedValue({ data: true });
    const { service, attempt, outcome } = newAttempt();
    await service.start(attempt, MODEL);
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("unknown"));
  });

  it("reports a correlated V1 abort rather than the successful HTTP acknowledgement", async () => {
    mocked.version = "v1";
    mocked.messages.mockResolvedValueOnce({ data: [] }).mockResolvedValue({
      data: [
        { info: { id: "manual" }, parts: [{ type: "compaction", auto: false }] },
        {
          info: {
            role: "assistant",
            summary: true,
            parentID: "manual",
            error: { name: "MessageAbortedError" },
          },
          parts: [],
        },
      ],
    });
    mocked.summarize.mockResolvedValue({ data: true });
    const { service, attempt, outcome } = newAttempt();
    await service.start(attempt, MODEL);
    await vi.waitFor(() => expect(outcome).toHaveBeenCalledWith("interrupted"));
  });

  it("keeps the tracked V1 summary out of ordinary background notices even after settlement", async () => {
    mocked.version = "v1";
    mocked.messages.mockResolvedValue({ data: [] });
    let resolve!: (result: { data: true }) => void;
    mocked.summarize.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { service, attempt, selected, notifySuccess } = newAttempt();
    const starting = service.start(attempt, MODEL);
    await vi.waitFor(() => expect(mocked.summarize).toHaveBeenCalled());
    service.detach(SESSION.id);
    selected.id = "other";
    const info = {
      id: "summary",
      sessionID: SESSION.id,
      role: "assistant",
      parentID: "manual",
      summary: true,
      finish: "stop",
      time: { completed: 10 },
    };
    const summary = { type: "message.updated", properties: { info } } as Event;
    mocked.message.mockResolvedValueOnce({ data: { parts: [{ type: "compaction", auto: true }] } });
    await expect(
      service.isLegacyCompactionSummary({
        ...summary,
        properties: { info: { ...info, id: "auto-summary", parentID: "auto" } },
      } as Event),
    ).resolves.toBe(false);
    mocked.message.mockResolvedValueOnce({
      data: { parts: [{ type: "compaction", auto: false }] },
    });
    await expect(service.isLegacyCompactionSummary(summary)).resolves.toBe(true);
    expect(
      service.isLegacyCompactionSummary({
        ...summary,
        properties: { info: { ...info, id: "reply", summary: false } },
      } as Event),
    ).toBe(false);

    mocked.messages.mockResolvedValue({
      data: [
        { info: { id: "manual" }, parts: [{ type: "compaction", auto: false }] },
        { info, parts: [] },
      ],
    });
    resolve({ data: true });
    await starting;
    expect(notifySuccess).toHaveBeenCalledOnce();
    expect(service.isActive(SESSION.id)).toBe(false);
    expect(service.isLegacyCompactionSummary(summary)).toBe(true);
  });

  it("waits for correlated history when a V1 parent lookup temporarily fails", async () => {
    mocked.version = "v1";
    mocked.messages.mockResolvedValue({ data: [] });
    mocked.message.mockResolvedValue({ error: new Error("lookup temporarily unavailable") });
    let resolve!: (result: { data: true }) => void;
    mocked.summarize.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { service, attempt, selected, notifySuccess } = newAttempt();
    const starting = service.start(attempt, MODEL);
    await vi.waitFor(() => expect(mocked.summarize).toHaveBeenCalled());
    service.detach(SESSION.id);
    selected.id = "other";
    const info = {
      id: "summary",
      sessionID: SESSION.id,
      role: "assistant",
      parentID: "manual",
      summary: true,
      finish: "stop",
      time: { completed: 10 },
    };
    const classify = vi.fn();
    const classification = Promise.resolve(
      service.isLegacyCompactionSummary({
        type: "message.updated",
        properties: { info },
      } as Event),
    ).then(classify);
    await vi.waitFor(() => expect(mocked.message).toHaveBeenCalledOnce());
    expect(classify).not.toHaveBeenCalled();

    mocked.messages.mockResolvedValue({
      data: [
        { info: { id: "manual" }, parts: [{ type: "compaction", auto: false }] },
        { info, parts: [] },
      ],
    });
    resolve({ data: true });
    await Promise.all([starting, classification]);
    expect(classify).toHaveBeenCalledWith(true);
    expect(notifySuccess).toHaveBeenCalledOnce();
  });
});
