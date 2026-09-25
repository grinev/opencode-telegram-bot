import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  admitPromptToInbox: vi.fn(),
  startInboxPromptRun: vi.fn(),
  processUserPrompt: vi.fn(),
  getPromptQueueMode: vi.fn(),
  isForegroundBusy: vi.fn(),
  cancelInboxPrompt: vi.fn(),
  reconcileInboxPrompts: vi.fn(),
  getCurrentSession: vi.fn(),
  getKeyboard: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/opencode/client.js")>()),
  opencodeServerVersion: "v2",
}));

vi.mock("../../../src/bot/handlers/prompt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/bot/handlers/prompt.js")>()),
  admitPromptToInbox: mocked.admitPromptToInbox,
  startInboxPromptRun: mocked.startInboxPromptRun,
  processUserPrompt: mocked.processUserPrompt,
}));

vi.mock("../../../src/app/stores/settings-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/stores/settings-store.js")>()),
  getPromptQueueMode: mocked.getPromptQueueMode,
}));

vi.mock("../../../src/app/services/run-control-service.js", () => ({
  isForegroundBusy: mocked.isForegroundBusy,
}));

vi.mock("../../../src/app/services/prompt-inbox-service.js", () => ({
  cancelInboxPrompt: mocked.cancelInboxPrompt,
  reconcileInboxPrompts: mocked.reconcileInboxPrompts,
}));

vi.mock("../../../src/app/services/session-service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/app/services/session-service.js")>()),
  getCurrentSession: mocked.getCurrentSession,
}));

import { MAX_QUEUED_PROMPTS, promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import {
  __resetPromptQueueDispatchForTests,
  dispatchNextQueuedPrompt,
  initializePromptQueueDispatch,
  rejectQueuedMediaBeforePreparation,
  tryEnqueuePrompt,
} from "../../../src/bot/handlers/prompt-queue-dispatch.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import { createTestAppContainer } from "../../helpers/app-container.js";

const KEYBOARD = { keyboard: [] };
const SESSION = { id: "ses-1", title: "Session", directory: "D:/repo" };

const DEPS = {
  ...createTestAppContainer({
    keyboardManager: {
      getKeyboard: mocked.getKeyboard,
    } as unknown as AppContainer["keyboardManager"],
  }),
  bot: {} as never,
};

let replyMock: ReturnType<typeof vi.fn>;

function makeContext(): Context {
  return { chat: { id: 42 }, api: {}, reply: replyMock } as unknown as Context;
}

describe("bot/handlers/prompt-queue-dispatch on OpenCode V2", () => {
  beforeEach(() => {
    promptQueue.__resetForTests();
    __resetPromptQueueDispatchForTests();
    DEPS.assistantRunState.clearAll("test");
    replyMock = vi.fn().mockResolvedValue(undefined);
    mocked.admitPromptToInbox
      .mockReset()
      .mockResolvedValue({ sessionId: "ses-1", inboxId: "msg-1" });
    mocked.startInboxPromptRun.mockReset().mockResolvedValue(undefined);
    mocked.processUserPrompt.mockReset();
    mocked.getPromptQueueMode.mockReset().mockReturnValue("steer");
    mocked.isForegroundBusy.mockReset().mockReturnValue(true);
    mocked.cancelInboxPrompt.mockReset().mockResolvedValue(undefined);
    mocked.reconcileInboxPrompts.mockReset().mockResolvedValue(undefined);
    mocked.getCurrentSession.mockReset().mockReturnValue(SESSION);
    mocked.getKeyboard.mockReset().mockReturnValue(KEYBOARD);
    initializePromptQueueDispatch(DEPS);
  });

  it("steers the prompt into the running turn and mirrors it as a button", async () => {
    const ctx = makeContext();

    const handled = await tryEnqueuePrompt(ctx, createIncomingPrompt("Also check the tests"));

    expect(handled).toBe(true);
    expect(mocked.admitPromptToInbox).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ text: "Also check the tests" }),
      DEPS,
      "steer",
    );
    expect(promptQueue.findByInboxId("msg-1")).toMatchObject({
      displayText: "Also check the tests",
      inbox: { sessionId: "ses-1", inboxId: "msg-1", delivery: "steer" },
    });
    expect(replyMock).toHaveBeenCalledWith(
      t("queue.steer_added", { count: "1", max: String(MAX_QUEUED_PROMPTS) }),
      { reply_markup: KEYBOARD },
    );
  });

  it("sends the prompt with queue delivery in Queue mode and keeps the queue reply", async () => {
    mocked.getPromptQueueMode.mockReturnValue("queue");

    await tryEnqueuePrompt(makeContext(), createIncomingPrompt("Next task"));

    expect(mocked.admitPromptToInbox).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      DEPS,
      "queue",
    );
    expect(replyMock).toHaveBeenCalledWith(
      t("queue.added", { count: "1", max: String(MAX_QUEUED_PROMPTS) }),
      { reply_markup: KEYBOARD },
    );
  });

  it("refuses the sixth waiting prompt without sending it", async () => {
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      promptQueue.confirmReservation(promptQueue.reserve()!, {
        displayText: `waiting ${index}`,
        inbox: { sessionId: "ses-1", inboxId: `msg-${index}`, delivery: "steer" },
      });
    }

    await tryEnqueuePrompt(makeContext(), createIncomingPrompt("One more"));

    expect(mocked.admitPromptToInbox).not.toHaveBeenCalled();
    expect(replyMock).toHaveBeenCalledWith(t("queue.full", { max: String(MAX_QUEUED_PROMPTS) }), {
      reply_markup: KEYBOARD,
    });
  });

  it("releases the slot and adds no button when OpenCode refuses the prompt", async () => {
    mocked.admitPromptToInbox.mockResolvedValue(null);

    const handled = await tryEnqueuePrompt(makeContext(), createIncomingPrompt("Refused"));

    expect(handled).toBe(true);
    expect(promptQueue.size()).toBe(0);
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      expect(promptQueue.reserve()).not.toBeNull();
    }
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("cancels a prompt whose queue was cleared while it was on its way", async () => {
    mocked.admitPromptToInbox.mockImplementation(async () => {
      promptQueue.clear("abort_command");
      return { sessionId: "ses-1", inboxId: "msg-1" };
    });

    await tryEnqueuePrompt(makeContext(), createIncomingPrompt("Too late"));

    expect(mocked.cancelInboxPrompt).toHaveBeenCalledWith(
      { sessionId: "ses-1", inboxId: "msg-1", delivery: "steer" },
      "withdrawn_during_admission",
    );
    expect(promptQueue.size()).toBe(0);
    expect(replyMock).not.toHaveBeenCalled();
  });

  it("opens a run and adds no button when OpenCode delivered the prompt before answering", async () => {
    mocked.admitPromptToInbox.mockImplementation(async () => {
      promptQueue.rememberDeliveredInboxId("msg-1");
      return { sessionId: "ses-1", inboxId: "msg-1" };
    });

    await tryEnqueuePrompt(makeContext(), createIncomingPrompt("Picked up at once"));

    expect(promptQueue.size()).toBe(0);
    expect(mocked.startInboxPromptRun).toHaveBeenCalledWith(SESSION, DEPS, undefined);
    expect(replyMock).toHaveBeenCalledTimes(1);
  });

  it("does not open a second run when one is already open for a prompt delivered first", async () => {
    DEPS.assistantRunState.startRun("ses-1", { startedAt: Date.now() });
    mocked.admitPromptToInbox.mockImplementation(async () => {
      promptQueue.rememberDeliveredInboxId("msg-1");
      return { sessionId: "ses-1", inboxId: "msg-1" };
    });

    await tryEnqueuePrompt(makeContext(), createIncomingPrompt("Mid-turn"));

    expect(mocked.startInboxPromptRun).not.toHaveBeenCalled();
  });

  it("does not apply the queued media cap to prompts that wait in OpenCode", async () => {
    await expect(rejectQueuedMediaBeforePreparation(makeContext(), undefined)).resolves.toBe(false);
    await expect(rejectQueuedMediaBeforePreparation(makeContext(), 50 * 1024 * 1024)).resolves.toBe(
      false,
    );
  });

  it("still refuses media before preparation when the queue is full", async () => {
    for (let index = 0; index < MAX_QUEUED_PROMPTS; index++) {
      promptQueue.reserve();
    }

    await expect(rejectQueuedMediaBeforePreparation(makeContext(), 10)).resolves.toBe(true);
  });

  it("reconciles the mirror instead of dispatching when the session goes idle", async () => {
    mocked.isForegroundBusy.mockReturnValue(false);

    await dispatchNextQueuedPrompt();

    expect(mocked.reconcileInboxPrompts).toHaveBeenCalledWith("ses-1");
    expect(mocked.processUserPrompt).not.toHaveBeenCalled();
  });
});
