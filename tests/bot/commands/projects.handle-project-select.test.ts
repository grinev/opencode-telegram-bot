import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import {
  handleProjectSearchCallback,
  handleProjectSearchTextInput,
  handleProjectSelect,
} from "../../../src/bot/callbacks/project-callback-handler.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

const mocked = vi.hoisted(() => ({
  getProjectsMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
}));

vi.mock("../../../src/app/services/project-service.js", () => ({
  getProjects: mocked.getProjectsMock,
  getListedProjects: mocked.getProjectsMock,
}));

vi.mock("../../../src/bot/menus/inline-menu.js", () => ({
  appendInlineMenuCancelButton: vi.fn(),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: vi.fn(),
}));

function createCallbackContext(data: string): Context {
  return {
    callbackQuery: { data } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createDeps() {
  return {
    ...container,
    resetInteractions: mocked.clearAllInteractionStateMock,
  };
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/commands/projects handleProjectSelect", () => {
  beforeEach(() => {
    mocked.getProjectsMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearAllInteractionStateMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
  });

  it("uses callback feedback and does not send chat reply on projects:page:* load error", async () => {
    const ctx = createCallbackContext("projects:page:1");
    const pageLoadError = new Error("failed to load page");
    mocked.getProjectsMock.mockRejectedValue(pageLoadError);

    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("projects.page_load_error"),
    });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mocked.clearAllInteractionStateMock).not.toHaveBeenCalled();
  });

  it("keeps project:* selection error behavior with state cleanup and chat error reply", async () => {
    const ctx = createCallbackContext("project:abc");
    mocked.getProjectsMock.mockResolvedValue([
      {
        id: "different-id",
        name: "Other project",
        worktree: "/tmp/other",
      },
    ]);

    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("project_select_error");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("projects.select_error") });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("blocks project selection callback while foreground session is busy", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createCallbackContext("project:abc");
    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(true);
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("bot.session_busy"),
    });
  });

  it("does not block permission callbacks while foreground session is busy", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createCallbackContext("permission:once");
    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
  });

  it("does not block question callbacks while foreground session is busy", async () => {
    container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const ctx = createCallbackContext("question:select:0:1");
    const handled = await handleProjectSelect(ctx, createDeps());

    expect(handled).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
  });

  it("moves from the search prompt to callback results and ignores whitespace", async () => {
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "text",
      metadata: { flow: "project-search", stage: "input" },
    });
    const ctx = {
      message: { text: "  " },
      reply: vi.fn().mockResolvedValue({ message_id: 77 }),
    } as unknown as Context;
    expect(await handleProjectSearchTextInput(ctx, createDeps())).toBe(true);
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
    Object.assign(ctx.message!, { text: " APP " });
    mocked.getProjectsMock.mockResolvedValue([{ id: "1", worktree: "/test/app" }]);
    await handleProjectSearchTextInput(ctx, createDeps());
    expect(ctx.reply).toHaveBeenCalledWith(
      t("projects.search.results", { query: " APP " }),
      expect.anything(),
    );
    expect(container.interactionManager.getSnapshot()?.expectedInput).toBe("callback");
    expect(container.interactionManager.getSnapshot()?.metadata.ids).toEqual(["1"]);
  });

  it("leaves search results intact when a page load fails", async () => {
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "project-search",
        stage: "results",
        query: "app",
        messageId: 77,
        ids: ["1"],
      },
    });
    const ctx = createCallbackContext("projects:search:page:1");
    Object.assign(ctx.callbackQuery!, { message: { message_id: 77 } });
    mocked.getProjectsMock.mockRejectedValue(new Error("offline"));
    await handleProjectSearchCallback(ctx, createDeps());
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("projects.page_load_error") });
    expect(container.interactionManager.getSnapshot()?.metadata.ids).toEqual(["1"]);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("rejects stale search callbacks without disturbing another interaction", async () => {
    const ctx = createCallbackContext("projects:search:cancel");
    await handleProjectSearchCallback(ctx, createDeps());
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
  });

  it("does not overwrite a replacement interaction during a search fetch", async () => {
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "text",
      metadata: { flow: "project-search", stage: "input" },
    });
    mocked.getProjectsMock.mockImplementation(async () => {
      container.interactionManager.start({
        kind: "custom",
        expectedInput: "callback",
        metadata: { flow: "replacement" },
      });
      return [{ id: "1", worktree: "/repo/app" }];
    });
    const ctx = { message: { text: "app" }, reply: vi.fn() } as unknown as Context;
    await handleProjectSearchTextInput(ctx, createDeps());
    expect(container.interactionManager.getSnapshot()?.metadata.flow).toBe("replacement");
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("starts search with idle commands refused and supports search again", async () => {
    container.interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: { menuKind: "project", messageId: 9 },
    });
    const ctx = createCallbackContext("projects:search");
    Object.assign(ctx, { deleteMessage: vi.fn().mockResolvedValue(undefined) });
    await handleProjectSearchCallback(ctx, createDeps());
    expect(container.interactionManager.getSnapshot()?.allowedCommands).toEqual([]);
    expect(ctx.reply).toHaveBeenCalledWith(t("projects.search.prompt"));
    container.interactionManager.transition({
      expectedInput: "callback",
      metadata: { flow: "project-search", stage: "results", messageId: 77 },
    });
    Object.assign(ctx.callbackQuery!, {
      data: "projects:search:again",
      message: { message_id: 77 },
    });
    await handleProjectSearchCallback(ctx, createDeps());
    expect(container.interactionManager.getSnapshot()?.expectedInput).toBe("text");
  });

  it("reloads a results page and keeps the new identifiers", async () => {
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "project-search",
        stage: "results",
        query: "app",
        messageId: 77,
        ids: ["old"],
      },
    });
    mocked.getProjectsMock.mockResolvedValue([{ id: "new", worktree: "/repo/app" }]);
    const ctx = createCallbackContext("projects:search:page:1");
    Object.assign(ctx.callbackQuery!, { message: { message_id: 77 } });
    await handleProjectSearchCallback(ctx, createDeps());
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(container.interactionManager.getSnapshot()?.metadata.ids).toEqual(["new"]);
  });

  it("cancels search results and deletes the message", async () => {
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: { flow: "project-search", stage: "results", messageId: 77 },
    });
    const ctx = createCallbackContext("projects:search:cancel");
    Object.assign(ctx.callbackQuery!, { message: { message_id: 77 } });
    Object.assign(ctx, { deleteMessage: vi.fn().mockResolvedValue(undefined) });
    await handleProjectSearchCallback(ctx, createDeps());
    expect(container.interactionManager.getSnapshot()).toBeNull();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("common.cancelled") });
    expect(ctx.deleteMessage).toHaveBeenCalled();
  });

  it("blocks result callbacks while busy without clearing search", async () => {
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: { flow: "project-search", stage: "results", messageId: 77 },
    });
    container.foregroundSessionState.markBusy("session-1", "/repo");
    const ctx = createCallbackContext("projects:search:cancel");
    await handleProjectSearchCallback(ctx, createDeps());
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("bot.session_busy") });
    expect(container.interactionManager.getSnapshot()?.metadata.flow).toBe("project-search");
  });

  it("uses the existing selection error for a result that disappeared", async () => {
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: { flow: "project-search", stage: "results", messageId: 77, ids: ["gone"] },
    });
    const ctx = createCallbackContext("projects:search:result:0");
    Object.assign(ctx.callbackQuery!, { message: { message_id: 77 } });
    mocked.getProjectsMock.mockResolvedValue([]);
    await handleProjectSearchCallback(ctx, createDeps());
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("project_select_error");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("projects.select_error") });
  });

  it("does not reset a replacement interaction when selecting a result", async () => {
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: { flow: "project-search", stage: "results", messageId: 77, ids: ["gone"] },
    });
    mocked.getProjectsMock.mockImplementation(async () => {
      container.interactionManager.start({
        kind: "custom",
        expectedInput: "callback",
        metadata: { flow: "replacement" },
      });
      return [];
    });
    const ctx = createCallbackContext("projects:search:result:0");
    Object.assign(ctx.callbackQuery!, { message: { message_id: 77 } });
    await handleProjectSearchCallback(ctx, createDeps());
    expect(container.interactionManager.getSnapshot()?.metadata.flow).toBe("replacement");
    expect(mocked.clearAllInteractionStateMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
  });
});
