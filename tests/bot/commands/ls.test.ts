import { afterEach, beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context } from "grammy";
import { loadSut } from "#helpers/sut-loader.js";
import { createSettingsStoreMock } from "#helpers/settings-store-mock.js";
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

// ---- Mutable mocks (registered BEFORE any SUT load) ----

const mocked = vi.hoisted(() => ({
  isForegroundBusyMock: vi.fn(),
  replyBusyBlockedMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearActiveInlineMenuMock: vi.fn(),
  interactionStartMock: vi.fn(),
  interactionClearMock: vi.fn(),
  sendDownloadedFileMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  scanLsDirectoryMock: vi.fn(),
  getFileDetailsMock: vi.fn(),
  readdirMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("#src/app/services/run-control-service.ts", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
}));

vi.mock("#src/bot/messages/busy-blocked-renderer.ts", () => ({
  replyBusyBlocked: mocked.replyBusyBlockedMock,
}));

const settingsStoreMock = createSettingsStoreMock();
settingsStoreMock.getCurrentProject = mocked.getCurrentProjectMock;
vi.mock("#src/app/stores/settings-store.ts", () => settingsStoreMock);

vi.mock("#src/bot/menus/inline-menu.ts", () => ({
  appendInlineMenuCancelButton: vi.fn((kb: unknown) => kb),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
}));

vi.mock("#src/app/managers/interaction-manager.ts", () => ({
  interactionManager: {
    start: mocked.interactionStartMock,
    getSnapshot: vi.fn(() => null),
    clear: mocked.interactionClearMock,
  },
  clearAllInteractionState: vi.fn(),
}));

vi.mock("#src/bot/messages/send-downloaded-file.ts", () => ({
  sendDownloadedFile: mocked.sendDownloadedFileMock,
}));

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    error: mocked.loggerErrorMock,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock file-browser-service (source uses Bun.Glob/Bun.file — not node:fs)
vi.mock("#src/app/services/file-browser-service.ts", () => ({
  getProjectRoot: () => mocked.getCurrentProjectMock()?.worktree ?? null,
  isWithinProjectRoot: (targetPath: string) => {
    const projectRoot = mocked.getCurrentProjectMock()?.worktree ?? null;
    if (!projectRoot) return false;
    return targetPath === projectRoot || targetPath.startsWith(projectRoot + "/");
  },
  isWithinProjectRootSafe: async (targetPath: string) => {
    const projectRoot = mocked.getCurrentProjectMock()?.worktree ?? null;
    if (!projectRoot) return false;
    return targetPath === projectRoot || targetPath.startsWith(projectRoot + "/");
  },
  isPathWithinDirectory: vi.fn((targetPath: string, directoryPath: string) => {
    return targetPath === directoryPath || targetPath.startsWith(directoryPath + "/");
  }),
  pathToDisplayPath: vi.fn((p: string) => {
    if (p.startsWith("/repo/project")) return "~/project";
    return p;
  }),
  isWithinAllowedRoot: vi.fn(() => true),
  isAllowedRoot: vi.fn(() => false),
  isProjectRoot: vi.fn((targetPath: string) => {
    const projectRoot = mocked.getCurrentProjectMock()?.worktree ?? null;
    return projectRoot !== null && targetPath === projectRoot;
  }),
  scanLsDirectory: mocked.scanLsDirectoryMock,
  getFileDetails: mocked.getFileDetailsMock,
  joinPath: vi.fn((parentPath: string, childName: string) => parentPath + "/" + childName),
  getParentPath: vi.fn((p: string) => {
    const idx = p.lastIndexOf("/");
    return idx > 0 ? p.slice(0, idx) : "/";
  }),
  getBaseName: vi.fn((p: string) => {
    const idx = p.lastIndexOf("/");
    return idx >= 0 ? p.slice(idx + 1) : p;
  }),
  buildEntryLabel: vi.fn((entry: { name: string; type?: string }) =>
    entry.type === "file" ? `📄 ${entry.name}` : `📁 ${entry.name}`,
  ),
  buildTreeHeader: vi.fn(
    (displayPath: string, _totalCount: number, _page: number, _totalPages: number) => {
      return `<code>${displayPath}</code>`;
    },
  ),
  MAX_ENTRIES_PER_PAGE: 8,
  __resetBrowserRootsForTests: vi.fn(),
  getBrowserRoots: vi.fn(() => ["/"]),
  scanDirectory: vi.fn(),
}));

// ---- Load SUTs ----

const { lsCommand } = await loadSut<typeof import("#src/bot/commands/ls-command.js")>(
  "#src/bot/commands/ls-command.ts",
  import.meta.url,
);

const sut = await loadSut<typeof import("#src/bot/callbacks/file-browser-callback-handler.js")>(
  "#src/bot/callbacks/file-browser-callback-handler.ts",
  import.meta.url,
);

const { clearLsPathIndex } = await loadSut<typeof import("#src/bot/menus/file-browser-menu.js")>(
  "#src/bot/menus/file-browser-menu.ts",
  import.meta.url,
);

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
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    api: {},
  } as unknown as Context;
}

function makeLsEntry(name: string, type: "file" | "directory") {
  return { name, fullPath: `/repo/project/${name}`, type };
}

describe("bot/commands/ls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    sut.clearSessionDirectories();
    clearLsPathIndex();
    mocked.scanLsDirectoryMock.mockReset();
    mocked.getFileDetailsMock.mockReset();
    mocked.isForegroundBusyMock.mockReset().mockReturnValue(false);
    mocked.replyBusyBlockedMock.mockReset().mockResolvedValue(undefined);
    mocked.getCurrentProjectMock.mockReset().mockReturnValue({
      id: "project-1",
      worktree: "/repo/project",
      name: "project",
    });
    mocked.ensureActiveInlineMenuMock.mockReset().mockResolvedValue(true);
    mocked.clearActiveInlineMenuMock.mockReset();
    mocked.interactionStartMock.mockReset();
    mocked.interactionClearMock.mockReset();
    mocked.sendDownloadedFileMock.mockReset().mockResolvedValue(true);
    mocked.loggerDebugMock.mockReset();
    mocked.loggerErrorMock.mockReset();

    // Default ls scan result
    mocked.scanLsDirectoryMock.mockResolvedValue({
      entries: [
        makeLsEntry("docs", "directory"),
        makeLsEntry("README.md", "file"),
      ],
      totalCount: 2,
      currentPath: "/repo/project",
      displayPath: "~/project",
      hasParent: false,
      page: 0,
    });

    mocked.getFileDetailsMock.mockResolvedValue({
      name: "README.md",
      fullPath: "/repo/project/README.md",
      size: 1234,
      modified: new Date("2024-01-02T00:00:00.000Z"),
    });
  });

  it("warns instead of listing when running in a container", async () => {
    vi.stubEnv("OPENCODE_TELEGRAM_CONTAINER", "1");
    const ctx = createCommandContext();

    await lsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("runtime.container.command_unavailable"));
    expect(mocked.readdirMock).not.toHaveBeenCalled();
  });

  it("opens an inline browser for the current project", async () => {
    const ctx = createCommandContext();

    await lsCommand(ctx as never);

    expect(mocked.scanLsDirectoryMock).toHaveBeenCalledWith("/repo/project", 0);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("<code>~/project</code>"),
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

  it("does not start an inline interaction for an empty project root", async () => {
    mocked.scanLsDirectoryMock.mockResolvedValue({
      entries: [],
      totalCount: 0,
      currentPath: "/repo/project",
      displayPath: "~/project",
      hasParent: false,
      page: 0,
    });

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining(t("ls.total", { count: 0 })), {
      parse_mode: "HTML",
    });
    expect(mocked.interactionStartMock).not.toHaveBeenCalled();
  });

  it("requires an active project", async () => {
    mocked.getCurrentProjectMock.mockReturnValue(undefined);

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    expect(mocked.scanLsDirectoryMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("bot.project_not_selected"));
  });

  it("blocks the command when foreground is busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    expect(mocked.replyBusyBlockedMock).toHaveBeenCalledWith(ctx);
    expect(mocked.scanLsDirectoryMock).not.toHaveBeenCalled();
  });

  it("uses an explicit path argument when provided", async () => {
    const ctx = {
      chat: { id: 123 },
      from: { id: 42 },
      match: "/repo/project/docs",
      reply: vi.fn().mockResolvedValue({ message_id: 77 }),
    } as unknown as Context;

    await lsCommand(ctx as never);

    expect(mocked.scanLsDirectoryMock).toHaveBeenCalledWith("/repo/project/docs", 0);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("<code>~/project</code>"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
  });

  it("rejects an explicit path outside the current project", async () => {
    const ctx = {
      chat: { id: 123 },
      from: { id: 42 },
      match: "/etc",
      reply: vi.fn().mockResolvedValue({ message_id: 77 }),
    } as unknown as Context;

    await lsCommand(ctx as never);

    expect(mocked.scanLsDirectoryMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(`❌ ${t("ls.access_denied")}`);
  });

  it("shows an error when the target directory cannot be listed", async () => {
    mocked.scanLsDirectoryMock.mockResolvedValue({
      error: `${t("ls.scan_error")}: Permission denied`,
    });

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(`❌ ${t("ls.scan_error")}: Permission denied`);
  });

  it("lists directories before files", async () => {
    mocked.scanLsDirectoryMock.mockResolvedValue({
      entries: [
        makeLsEntry("b-dir", "directory"),
        makeLsEntry("z-last-dir", "directory"),
        makeLsEntry("a-file.txt", "file"),
        makeLsEntry("c-file.txt", "file"),
      ],
      totalCount: 4,
      currentPath: "/repo/project",
      displayPath: "~/project",
      hasParent: false,
      page: 0,
    });

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const labels = keyboard.inline_keyboard
      .slice(0, 4)
      .map((row: Array<{ text: string }>) => row[0]?.text);

    expect(labels).toEqual(["📁 b-dir", "📁 z-last-dir", "📄 a-file.txt", "📄 c-file.txt"]);
  });

  it("navigates into a directory when tapping its button", async () => {
    const commandCtx = createCommandContext();
    await lsCommand(commandCtx as never);

    const keyboard = (commandCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const callbackData = keyboard.inline_keyboard[0][0].callback_data as string;

    mocked.scanLsDirectoryMock.mockResolvedValue({
      entries: [makeLsEntry("nested.txt", "file")],
      totalCount: 1,
      currentPath: "/repo/project/docs",
      displayPath: "~/project/docs",
      hasParent: true,
      page: 0,
    });

    const callbackCtx = createCallbackContext(callbackData);
    const handled = await sut.handleLsCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(mocked.scanLsDirectoryMock).toHaveBeenLastCalledWith("/repo/project/docs", 0);
    expect(callbackCtx.editMessageText).toHaveBeenCalled();
  });

  it("shows file details when tapping a file", async () => {
    const commandCtx = createCommandContext();
    await lsCommand(commandCtx as never);

    const keyboard = (commandCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const callbackData = keyboard.inline_keyboard[1][0].callback_data as string;

    const callbackCtx = createCallbackContext(callbackData);
    const handled = await sut.handleLsCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining(t("ls.file.header")),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("README.md"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
    expect(mocked.sendDownloadedFileMock).not.toHaveBeenCalled();
  });

  it("downloads from file details view and ends the interaction", async () => {
    const callbackCtx = createCallbackContext("ls:download:/repo/project/README.md");
    const handled = await sut.handleLsCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(callbackCtx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("commands.download.downloading"),
    });
    expect(mocked.sendDownloadedFileMock).toHaveBeenCalledWith(
      callbackCtx,
      "/repo/project/README.md",
      { announce: false },
    );
    expect(mocked.clearActiveInlineMenuMock).toHaveBeenCalledWith("ls_downloaded");
    expect(callbackCtx.deleteMessage).toHaveBeenCalled();
  });

  it("returns to the file list from file details back button", async () => {
    const callbackCtx = createCallbackContext("ls:back:/repo/project|0");
    const handled = await sut.handleLsCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("<code>~/project</code>"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
  });

  it("shows a next page button when directory contents exceed one page", async () => {
    mocked.scanLsDirectoryMock.mockResolvedValue({
      entries: Array.from({ length: 8 }, (_, index) => makeLsEntry(`dir-${index + 1}`, "directory")),
      totalCount: 9,
      currentPath: "/repo/project",
      displayPath: "~/project",
      hasParent: false,
      page: 0,
    });

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const flatButtons = keyboard.inline_keyboard.flat();

    expect(
      flatButtons.some((button: { text?: string }) => button.text === t("open.next_page")),
    ).toBe(true);
  });

  it("loads the next page when tapping the next button", async () => {
    mocked.scanLsDirectoryMock
      .mockResolvedValueOnce({
        entries: Array.from({ length: 8 }, (_, index) => makeLsEntry(`dir-${index + 1}`, "directory")),
        totalCount: 9,
        currentPath: "/repo/project",
        displayPath: "~/project",
        hasParent: false,
        page: 0,
      })
      .mockResolvedValueOnce({
        entries: [makeLsEntry("dir-9", "directory")],
        totalCount: 9,
        currentPath: "/repo/project",
        displayPath: "~/project",
        hasParent: false,
        page: 1,
      });

    const commandCtx = createCommandContext();
    await lsCommand(commandCtx as never);

    const keyboard = (commandCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const flatButtons = keyboard.inline_keyboard.flat();
    const nextButton = flatButtons.find(
      (button: { text?: string }) => button.text === t("open.next_page"),
    );

    expect(nextButton?.callback_data).toBeDefined();

    const callbackCtx = createCallbackContext(nextButton?.callback_data as string);
    const handled = await sut.handleLsCallback(callbackCtx);

    expect(handled).toBe(true);
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("(2/2)"),
      expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }),
    );
  });

  it("blocks callbacks when foreground is busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);

    const ctx = createCallbackContext("ls:nav:/repo/project/docs");
    const handled = await sut.handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.replyBusyBlockedMock).toHaveBeenCalledWith(ctx);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("ignores stale callbacks when the inline menu is inactive", async () => {
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(false);

    const ctx = createCallbackContext("ls:nav:/repo/project/docs");
    const handled = await sut.handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect(mocked.sendDownloadedFileMock).not.toHaveBeenCalled();
  });

  it("denies navigation outside the current project", async () => {
    const ctx = createCallbackContext("ls:nav:/etc");
    const handled = await sut.handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("ls.access_denied"),
      show_alert: true,
    });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("denies pagination outside the current project", async () => {
    const ctx = createCallbackContext("ls:pg:/etc|1");
    const handled = await sut.handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("ls.access_denied"),
      show_alert: true,
    });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("denies file details outside the current project", async () => {
    const ctx = createCallbackContext("ls:file:/etc/passwd|0");
    const handled = await sut.handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("ls.access_denied"),
      show_alert: true,
    });
    expect(mocked.sendDownloadedFileMock).not.toHaveBeenCalled();
  });

  it("denies download outside the current project", async () => {
    const ctx = createCallbackContext("ls:download:/etc/passwd");
    const handled = await sut.handleLsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("ls.access_denied"),
      show_alert: true,
    });
    expect(mocked.sendDownloadedFileMock).not.toHaveBeenCalled();
  });

  it("shows a back button for navigating to parent directory", async () => {
    mocked.scanLsDirectoryMock.mockResolvedValue({
      entries: [makeLsEntry("nested.txt", "file")],
      totalCount: 1,
      currentPath: "/repo/project/docs",
      displayPath: "~/project/docs",
      hasParent: true,
      page: 0,
    });

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
    mocked.scanLsDirectoryMock.mockResolvedValue({
      entries: [makeLsEntry("README.md", "file")],
      totalCount: 1,
      currentPath: "/repo/project",
      displayPath: "~/project",
      hasParent: false,
      page: 0,
    });

    const ctx = createCommandContext();
    await lsCommand(ctx as never);

    const keyboard = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.reply_markup;
    const flatButtons = keyboard.inline_keyboard.flat();

    expect(
      flatButtons.some((button: { text?: string }) => button.text === t("open.back")),
    ).toBe(false);
  });

  it("reuses a cached directory only when it is inside the current project", async () => {
    const firstCtx = {
      chat: { id: 123 },
      from: { id: 42 },
      match: "/repo/project/docs",
      reply: vi.fn().mockResolvedValue({ message_id: 77 }),
    } as unknown as Context;

    await lsCommand(firstCtx as never);

    const secondCtx = createCommandContext();
    await lsCommand(secondCtx as never);

    expect(mocked.scanLsDirectoryMock).toHaveBeenLastCalledWith("/repo/project/docs", 0);
  });

  it("falls back to the project root when cached directory is outside the current project", async () => {
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

    expect(mocked.scanLsDirectoryMock).toHaveBeenLastCalledWith("/repo/project", 0);
  });
});
