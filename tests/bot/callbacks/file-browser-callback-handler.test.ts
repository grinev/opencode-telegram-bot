import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { promptAttachment } from "../../../src/app/managers/prompt-attachment-manager.js";
import { handleLsCallback } from "../../../src/bot/callbacks/file-browser-callback-handler.js";
import { LS_CALLBACK_ATTACH_PREFIX } from "../../../src/bot/menus/file-browser-menu.js";
import { defined } from "../../helpers/defined.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

const PROJECT_ROOT = "D:\\Repo";
const FILE_PATH = "D:\\Repo\\src\\index.ts";

const mocked = vi.hoisted(() => ({
  isForegroundBusyMock: vi.fn(() => false),
  ensureActiveInlineMenuMock: vi.fn(async () => true),
  clearActiveInlineMenuMock: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/app/services/run-control-service.js", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
}));

vi.mock("../../../src/bot/menus/inline-menu.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/bot/menus/inline-menu.js")>();
  return {
    ...actual,
    ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
    clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
  };
});

// Drives both getProjectRoot() and isWithinProjectRoot(), which are pure path math.
vi.mock("../../../src/app/stores/settings-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/app/stores/settings-store.js")>();
  return {
    ...actual,
    getCurrentProject: vi.fn(() => ({ id: "project-1", worktree: PROJECT_ROOT })),
  };
});

function createContext(data: string): Context {
  return {
    callbackQuery: { data, message: { message_id: 42 } },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 43 }),
    from: { id: 1 },
  } as unknown as Context;
}

function createDeps() {
  return container;
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/callbacks/file-browser-callback-handler - attach branch", () => {
  beforeEach(() => {
    promptAttachment.__resetForTests();
    container.interactionManager.clear("test_reset");
    mocked.isForegroundBusyMock.mockReturnValue(false);
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.clearActiveInlineMenuMock.mockReset();
  });

  it("stores the file, closes the menu and confirms with a cancel button", async () => {
    const ctx = createContext(`${LS_CALLBACK_ATTACH_PREFIX}${FILE_PATH}`);
    const deps = createDeps();

    expect(await handleLsCallback(ctx, deps)).toBe(true);

    expect(promptAttachment.get()).toEqual({
      absolutePath: FILE_PATH,
      worktree: PROJECT_ROOT,
      confirmationMessageId: 43,
    });
    expect(mocked.clearActiveInlineMenuMock).toHaveBeenCalledWith("ls_attached", deps);
    expect(ctx.deleteMessage).toHaveBeenCalled();

    const [[text, options]] = (ctx.reply as unknown as ReturnType<typeof vi.fn>).mock.calls as [
      [string, { reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } }],
    ];
    expect(text).toContain("src\\index.ts");
    expect(defined(options.reply_markup.inline_keyboard[0]?.[0]).callback_data).toBe("attach:cancel");
  });

  it("enters the waiting-for-prompt mode", async () => {
    await handleLsCallback(createContext(`${LS_CALLBACK_ATTACH_PREFIX}${FILE_PATH}`), createDeps());

    const state = container.interactionManager.getSnapshot();
    expect(state).toMatchObject({
      kind: "custom",
      expectedInput: "mixed",
      metadata: { flow: "attachment" },
    });
  });

  it("rejects a path outside the project root", async () => {
    const ctx = createContext(`${LS_CALLBACK_ATTACH_PREFIX}D:\\Other\\secret.ts`);

    expect(await handleLsCallback(ctx, createDeps())).toBe(true);
    expect(promptAttachment.get()).toBeNull();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: expect.any(String),
      show_alert: true,
    });
  });

  it("ignores a stale callback whose menu is no longer active", async () => {
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(false);
    const ctx = createContext(`${LS_CALLBACK_ATTACH_PREFIX}${FILE_PATH}`);

    expect(await handleLsCallback(ctx, createDeps())).toBe(true);
    expect(promptAttachment.get()).toBeNull();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("does not attach while the session is busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);
    const ctx = createContext(`${LS_CALLBACK_ATTACH_PREFIX}${FILE_PATH}`);

    expect(await handleLsCallback(ctx, createDeps())).toBe(true);
    expect(promptAttachment.get()).toBeNull();
  });
});
