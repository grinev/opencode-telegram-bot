import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  isForegroundBusyMock: vi.fn(),
  replyBusyBlockedMock: vi.fn(),
  getBrowserRootsMock: vi.fn(),
  isWithinAllowedRootMock: vi.fn(),
  isAllowedRootMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  interactionStartMock: vi.fn(),
  sendDownloadedFileMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
  promises: {
    readdir: mocked.readdirMock,
  },
}));

vi.mock("../../../src/bot/utils/busy-guard.js", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
  replyBusyBlocked: mocked.replyBusyBlockedMock,
}));

vi.mock("../../../src/bot/utils/browser-roots.js", () => ({
  getBrowserRoots: mocked.getBrowserRootsMock,
  isWithinAllowedRoot: mocked.isWithinAllowedRootMock,
  isAllowedRoot: mocked.isAllowedRootMock,
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  appendInlineMenuCancelButton: vi.fn((kb: unknown) => kb),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
}));

vi.mock("../../../src/interaction/manager.js", () => ({
  interactionManager: {
    start: mocked.interactionStartMock,
    getSnapshot: vi.fn(() => null),
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/bot/utils/send-downloaded-file.js", () => ({
  sendDownloadedFile: mocked.sendDownloadedFileMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    error: mocked.loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { clearLsPathIndex, clearSessionDirectories, handleLsCallback, lsCommand } from "../../../src/bot/commands/ls.js";

function createCommandContext(): Context {
  return {
    chat: { id: 123 },
    from: { id: 42 },
    match: "",
    reply: vi.fn().mockResolvedValue({ message_id: 77 }),
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number = 77): Context {
  return {
    chat: { id: 123 },
    from: { id: 42 },
    callbackQuery: {
      data,
      message: { message_id: messageId },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    api: {},
  } as unknown as Context;
}

describe("bot/commands/ls", () => {
  beforeEach(() => {
    clearSessionDirectories();
    clearLsPathIndex();
    mocked.readdirMock.mockReset().mockResolvedValue([
      { name: "docs", isDirectory: () => true },
      { name: "README.md", isDirectory: () => false },
    ]);
    mocked.isForegroundBusyMock.mockReset().mockReturnValue(false);
    mocked.replyBusyBlockedMock.mockReset().mockResolvedValue(undefined);
    mocked.getBrowserRootsMock.mockReset().mockReturnValue(["/home/user"]);
    mocked.isWithinAllowedRootMock.mockReset().mockReturnValue(true);
    mocked.isAllowedRootMock.mockReset().mockReturnValue(false);
    mocked.getCurrentProjectMock.mockReset().mockReturnValue({
      id: "project-1",
      worktree: "/repo/project",
      name: "project",
    });
    mocked.ensureActiveInlineMenuMock.mockReset().mockResolvedValue(true);
    mocked.interactionStartMock.mockReset();
    mocked.sendDownloadedFileMock.mockReset().mockResolvedValue(true);
    mocked.loggerDebugMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  it("opens an inline browser for the current project", async () => {
    const ctx = createCommandContext();

    await lsCommand(ctx as never);

    expect(mocked.readdirMock).toHaveBeenCalledWith("/repo/project", { withFileTypes: true });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("<code>/repo/project</code>"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
    expect(mocked.interactionStartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "inline",
        expectedInput: "callback",
        metadata: expect.objectContaining({ menuKind: "ls", messageId: 77 }),
      }),
    );
  });

  it("blocks the command when foreground is busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    expect(mocked.replyBusyBlockedMock).toHaveBeenCalledWith(ctx);
    expect(mocked.readdirMock).not.toHaveBeenCalled();
  });

  it("uses an explicit path argument when provided", async () => {
    const ctx = {
      chat: { id: 123 },
      from: { id: 42 },
      match: "/repo/project/docs",
      reply: vi.fn().mockResolvedValue({ message_id: 77 }),
    } as unknown as Context;

    await lsCommand(ctx as never);

    expect(mocked.readdirMock).toHaveBeenCalledWith("/repo/project/docs", { withFileTypes: true });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("<code>/repo/project/docs</code>"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
  });

  it("falls back to the first browser root when no project is selected", async () => {
    mocked.getCurrentProjectMock.mockReturnValue(undefined);

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    expect(mocked.readdirMock).toHaveBeenCalledWith("/home/user", { withFileTypes: true });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("<code>~</code>"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
  });

  it("shows an error when the target directory cannot be listed", async () => {
    mocked.readdirMock.mockRejectedValue(new Error("Permission denied"));

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(`❌ ${t("ls.scan_error")}: Permission denied`);
  });

  it("lists directories before files", async () => {
    mocked.readdirMock.mockResolvedValue([
      { name: "z-last-dir", isDirectory: () => true },
      { name: "a-file.txt", isDirectory: () => false },
      { name: "b-dir", isDirectory: () => true },
      { name: "c-file.txt", isDirectory: () => false },
    ]);

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const labels = keyboard.inline_keyboard.slice(0, 4).map((row: Array<{ text: string }>) => row[0]?.text);

    expect(labels).toEqual(["📁 b-dir", "📁 z-last-dir", "📄 a-file.txt", "📄 c-file.txt"]);
  });

  it("navigates into a directory when tapping its button", async () => {
    const commandCtx = createCommandContext();
    await lsCommand(commandCtx as never);

    const keyboard = (commandCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const callbackData = keyboard.inline_keyboard[0][0].callback_data as string;

    mocked.readdirMock.mockResolvedValue([{ name: "nested.txt", isDirectory: () => false }]);

    const callbackCtx = createCallbackContext(callbackData);
    const handled = await handleLsCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(mocked.readdirMock).toHaveBeenLastCalledWith("/repo/project/docs", { withFileTypes: true });
    expect(callbackCtx.editMessageText).toHaveBeenCalled();
  });

  it("downloads a file when tapping its button", async () => {
    const commandCtx = createCommandContext();
    await lsCommand(commandCtx as never);

    const keyboard = (commandCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const callbackData = keyboard.inline_keyboard[1][0].callback_data as string;

    const callbackCtx = createCallbackContext(callbackData);
    const handled = await handleLsCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(callbackCtx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("commands.download.downloading") });
    expect(mocked.sendDownloadedFileMock).toHaveBeenCalledWith(callbackCtx, "/repo/project/README.md", {
      announce: false,
    });
  });

  it("shows a next page button when directory contents exceed one page", async () => {
    mocked.readdirMock.mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => ({
        name: `dir-${index + 1}`,
        isDirectory: () => true,
      })),
    );

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const flatButtons = keyboard.inline_keyboard.flat();

    expect(flatButtons.some((button: { text?: string }) => button.text === t("open.next_page"))).toBe(true);
  });

  it("loads the next page when tapping the next button", async () => {
    mocked.readdirMock.mockResolvedValue(
      Array.from({ length: 9 }, (_, index) => ({
        name: `dir-${index + 1}`,
        isDirectory: () => true,
      })),
    );

    const commandCtx = createCommandContext();
    await lsCommand(commandCtx as never);

    const keyboard = (commandCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const flatButtons = keyboard.inline_keyboard.flat();
    const nextButton = flatButtons.find((button: { text?: string }) => button.text === t("open.next_page"));

    expect(nextButton?.callback_data).toBeDefined();

    const callbackCtx = createCallbackContext(nextButton?.callback_data as string);
    const handled = await handleLsCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("(2/2)"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
  });

  it("blocks callbacks when foreground is busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);

    const ctx = createCallbackContext("ls:nav:/repo/project/docs");
    const handled = await handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.replyBusyBlockedMock).toHaveBeenCalledWith(ctx);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("ignores stale callbacks when the inline menu is inactive", async () => {
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(false);

    const ctx = createCallbackContext("ls:nav:/repo/project/docs");
    const handled = await handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect(mocked.sendDownloadedFileMock).not.toHaveBeenCalled();
  });

  it("denies navigation outside allowed roots", async () => {
    mocked.isWithinAllowedRootMock.mockImplementation((targetPath: string) => targetPath === "/repo/project");

    const ctx = createCallbackContext("ls:nav:/etc");
    const handled = await handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("ls.access_denied") });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("denies pagination outside allowed roots", async () => {
    mocked.isWithinAllowedRootMock.mockImplementation((targetPath: string) => targetPath === "/repo/project");

    const ctx = createCallbackContext("ls:pg:/etc|1");
    const handled = await handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("ls.access_denied") });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("denies file downloads outside allowed roots", async () => {
    mocked.isWithinAllowedRootMock.mockImplementation((targetPath: string) => targetPath === "/repo/project");

    const ctx = createCallbackContext("ls:file:/etc/passwd");
    const handled = await handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("ls.access_denied") });
    expect(mocked.sendDownloadedFileMock).not.toHaveBeenCalled();
  });

  it("shows a back button for navigating to parent directory", async () => {
    mocked.isAllowedRootMock.mockImplementation((targetPath: string) => targetPath === "/home/user");
    mocked.readdirMock.mockResolvedValue([{ name: "nested.txt", isDirectory: () => false }]);

    const ctx = {
      chat: { id: 123 },
      from: { id: 42 },
      match: "/repo/project/docs",
      reply: vi.fn().mockResolvedValue({ message_id: 77 }),
    } as unknown as Context;

    await lsCommand(ctx as never);

    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const flatButtons = keyboard.inline_keyboard.flat();
    expect(
      flatButtons.some(
        (button: { callback_data?: string }) => button.callback_data === "ls:nav:/repo/project",
      ),
    ).toBe(true);
  });

  it("does not show a back button at the project root", async () => {
    mocked.readdirMock.mockResolvedValue([{ name: "README.md", isDirectory: () => false }]);

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const flatButtons = keyboard.inline_keyboard.flat();

    expect(flatButtons.some((button: { text?: string }) => button.text === t("open.back"))).toBe(false);
  });

  it("prefers the active project over a cached home directory", async () => {
    mocked.getCurrentProjectMock.mockReturnValueOnce(undefined);

    const firstCtx = createCommandContext();
    await lsCommand(firstCtx as never);

    mocked.getCurrentProjectMock.mockReturnValue({
      id: "project-1",
      worktree: "/repo/project",
      name: "project",
    });

    const secondCtx = createCommandContext();
    await lsCommand(secondCtx as never);

    expect(mocked.readdirMock).toHaveBeenLastCalledWith("/repo/project", { withFileTypes: true });
    expect(secondCtx.reply).toHaveBeenCalledWith(
      expect.stringContaining("<code>/repo/project</code>"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
  });
});
