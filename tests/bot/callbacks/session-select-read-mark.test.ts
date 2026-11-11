import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectSessionById, type SessionSelectDeps } from "../../../src/bot/callbacks/session-callback-handler.js";

const mocked = vi.hoisted(() => ({
  getSession: vi.fn(),
  messages: vi.fn(),
  message: vi.fn(),
  status: vi.fn(),
  setCurrentSession: vi.fn(),
  applySessionSettings: vi.fn(),
  attachToSession: vi.fn(),
  resolveProjectAgent: vi.fn(),
  getStoredModel: vi.fn(),
  markRead: vi.fn(),
  sendBotText: vi.fn(),
  sendRenderedBotPart: vi.fn(),
  getCurrentProject: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      get: mocked.getSession,
      messages: mocked.messages,
      message: mocked.message,
      status: mocked.status,
    },
  },
}));
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: () => mocked.getCurrentProject(),
  getCurrentSession: () => undefined,
}));
vi.mock("../../../src/app/services/session-service.js", () => ({
  setCurrentSession: mocked.setCurrentSession,
}));
vi.mock("../../../src/app/services/session-settings-service.js", () => ({
  applySessionSettings: mocked.applySessionSettings,
}));
vi.mock("../../../src/app/services/session-reply-read-service.js", () => ({
  markSessionReplyRead: mocked.markRead,
}));
vi.mock("../../../src/app/services/agent-selection-service.js", () => ({
  getStoredAgent: () => "build",
  resolveProjectAgent: mocked.resolveProjectAgent,
  selectAgent: vi.fn(),
}));
vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: mocked.getStoredModel,
  selectModel: vi.fn(),
}));
vi.mock("../../../src/app/services/attach-service.js", () => ({
  attachToSession: mocked.attachToSession,
}));
vi.mock("../../../src/app/services/run-control-service.js", () => ({
  isForegroundBusy: () => false,
}));
vi.mock("../../../src/bot/messages/telegram-text.js", () => ({
  AGENT_TEXT_LINK_PREVIEW_OPTIONS: {},
  sendBotText: mocked.sendBotText,
  sendRenderedBotPart: mocked.sendRenderedBotPart,
}));
vi.mock("../../../src/bot/messages/assistant-rendering.js", () => ({
  renderAssistantFinalPartsSafe: (text: string) => [{ text }],
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mocked.warn, error: mocked.error },
}));

const session = { id: "s1", title: "Session", directory: "/repo", projectID: "p1" };

function context() {
  const api = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 10 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  };
  return {
    chat: { id: 1 },
    api,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
  };
}

function deps(): SessionSelectDeps {
  return {
    bot: {} as SessionSelectDeps["bot"],
    attachManager: {} as SessionSelectDeps["attachManager"],
    ensureEventSubscription: vi.fn(),
    foregroundSessionState: {} as SessionSelectDeps["foregroundSessionState"],
    interactionManager: {} as SessionSelectDeps["interactionManager"],
    permissionManager: {} as SessionSelectDeps["permissionManager"],
    questionManager: {} as SessionSelectDeps["questionManager"],
    resetInteractions: vi.fn(),
    pinnedMessageManager: {
      getState: () => ({ sessionId: null, messageId: null }),
      onModelChange: vi.fn(),
    } as unknown as SessionSelectDeps["pinnedMessageManager"],
    keyboardManager: {
      updateAgent: vi.fn(),
      updateModel: vi.fn(),
      getContextInfo: () => undefined,
      updateContext: vi.fn(),
      getKeyboard: () => undefined,
    } as unknown as SessionSelectDeps["keyboardManager"],
    summaryAggregator: {
      holdOutbound: () => 1,
      hasDeferredOutbound: () => false,
      drainOutbound: vi.fn(),
    } as unknown as SessionSelectDeps["summaryAggregator"],
  };
}

const replyMessages = [
  { info: { id: "m1", role: "assistant", time: { created: 200, completed: 250 } }, parts: [{ type: "text", text: "the answer" }] },
];

describe("clearing the unread reply mark on session selection", () => {
  beforeEach(() => {
    mocked.getSession.mockReset().mockResolvedValue({ data: session, error: null });
    mocked.messages.mockReset().mockResolvedValue({ data: replyMessages, error: null });
    mocked.message.mockReset().mockResolvedValue({ data: null, error: null });
    mocked.status.mockReset().mockResolvedValue({ data: {}, error: null });
    mocked.applySessionSettings.mockReset().mockResolvedValue(false);
    mocked.attachToSession.mockReset().mockResolvedValue(undefined);
    mocked.resolveProjectAgent.mockReset().mockResolvedValue("build");
    mocked.getStoredModel.mockReset().mockReturnValue({ providerID: "p", modelID: "m" });
    mocked.markRead.mockReset();
    mocked.sendBotText.mockReset().mockResolvedValue(undefined);
    mocked.sendRenderedBotPart.mockReset().mockResolvedValue(undefined);
    mocked.getCurrentProject.mockReset().mockReturnValue({ id: "p1", worktree: "/repo", name: "repo" });
  });

  it("marks the session read with the shown reply's completion time", async () => {
    await selectSessionById(context() as never, deps(), "s1", {
      source: "menu",
      deleteCallbackMessage: true,
      removeCallbackReplyMarkup: false,
      postSelectAction: "preview",
    });

    expect(mocked.sendRenderedBotPart).toHaveBeenCalledTimes(1);
    expect(mocked.markRead).toHaveBeenCalledWith("s1", 250);
  });

  it("leaves the mark when the reply never reaches the chat", async () => {
    mocked.sendRenderedBotPart.mockRejectedValue(new Error("Bad Request: message is too long"));

    await expect(selectSessionById(context() as never, deps(), "s1", {
      source: "menu",
      deleteCallbackMessage: true,
      removeCallbackReplyMarkup: false,
      postSelectAction: "preview",
    })).rejects.toThrow("message is too long");

    expect(mocked.markRead).not.toHaveBeenCalled();
  });

  it("shows nothing and marks nothing for a selection with no reply to show", async () => {
    await selectSessionById(context() as never, deps(), "s1", {
      source: "background_notification",
      deleteCallbackMessage: false,
      removeCallbackReplyMarkup: true,
      postSelectAction: "none",
    });

    expect(mocked.messages).not.toHaveBeenCalled();
    expect(mocked.markRead).not.toHaveBeenCalled();
  });

  it("marks the session read after the notification's own latest-reply send", async () => {
    await selectSessionById(context() as never, deps(), "s1", {
      source: "background_notification",
      deleteCallbackMessage: false,
      removeCallbackReplyMarkup: true,
      postSelectAction: "latest_assistant_response",
    });

    await vi.waitFor(() => expect(mocked.markRead).toHaveBeenCalledWith("s1", 250));
  });

  it("leaves the mark when the notification's reply send fails", async () => {
    mocked.sendRenderedBotPart.mockRejectedValue(new Error("Forbidden: bot was blocked by the user"));

    await selectSessionById(context() as never, deps(), "s1", {
      source: "background_notification",
      deleteCallbackMessage: false,
      removeCallbackReplyMarkup: true,
      postSelectAction: "latest_assistant_response",
    });

    await vi.waitFor(() => expect(mocked.error).toHaveBeenCalled());
    expect(mocked.markRead).not.toHaveBeenCalled();
  });

  it("leaves the mark when the reply the notification shows had failed", async () => {
    mocked.messages.mockResolvedValue({
      data: [{ info: { id: "m1", role: "assistant", error: "boom", time: { created: 200, completed: 250 } }, parts: [{ type: "text", text: "half an answer" }] }],
      error: null,
    });

    await selectSessionById(context() as never, deps(), "s1", {
      source: "background_notification",
      deleteCallbackMessage: false,
      removeCallbackReplyMarkup: true,
      postSelectAction: "latest_assistant_response",
    });

    await vi.waitFor(() => expect(mocked.sendRenderedBotPart).toHaveBeenCalled());
    expect(mocked.markRead).not.toHaveBeenCalled();
  });

  it("leaves the mark alone when the notification shows a reply still streaming", async () => {
    mocked.messages.mockResolvedValue({
      data: [{ info: { id: "m1", role: "assistant", time: { created: 200 } }, parts: [{ type: "text", text: "so far" }] }],
      error: null,
    });

    await selectSessionById(context() as never, deps(), "s1", {
      source: "background_notification",
      deleteCallbackMessage: false,
      removeCallbackReplyMarkup: true,
      postSelectAction: "latest_assistant_response",
    });

    await vi.waitFor(() => expect(mocked.sendRenderedBotPart).toHaveBeenCalled());
    expect(mocked.markRead).not.toHaveBeenCalled();
  });

  it("leaves the mark alone when the preview shows a reply still streaming", async () => {
    mocked.messages.mockResolvedValue({
      data: [{ info: { id: "m1", role: "assistant", time: { created: 200 } }, parts: [{ type: "text", text: "so far" }] }],
      error: null,
    });

    await selectSessionById(context() as never, deps(), "s1", {
      source: "menu",
      deleteCallbackMessage: true,
      removeCallbackReplyMarkup: false,
      postSelectAction: "preview",
    });

    expect(mocked.sendRenderedBotPart).toHaveBeenCalledTimes(1);
    expect(mocked.markRead).not.toHaveBeenCalled();
  });
});
