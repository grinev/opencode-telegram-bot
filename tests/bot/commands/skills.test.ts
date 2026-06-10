import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import { skillsCommand } from "../../../src/bot/commands/skills-catalog-command.js";
import { handleSkillsCallback } from "../../../src/bot/callbacks/skills-catalog-callback-handler.js";
import { handleSkillTextArguments } from "../../../src/bot/handlers/text-message-handler.js";
import {
  calculateSkillsPaginationRange,
  formatSkillsSelectText,
  parseSkillPageCallback,
} from "../../../src/bot/menus/skills-catalog-menu.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { t } from "../../../src/i18n/index.js";
import type { ProcessPromptDeps } from "../../../src/bot/handlers/prompt.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  commandListMock: vi.fn(),
  processUserPromptMock: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    command: {
      list: mocked.commandListMock,
    },
  },
}));

vi.mock("../../../src/bot/handlers/prompt.js", () => ({
  processUserPrompt: mocked.processUserPromptMock,
}));

function createCommandContext(messageId: number): Context {
  return {
    chat: { id: 777 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    reply: vi.fn().mockResolvedValue({ message_id: 901 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 902 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createTextContext(text: string): Context {
  return {
    chat: { id: 777 },
    message: { text } as Context["message"],
    reply: vi.fn().mockResolvedValue({ message_id: 903 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 904 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createDeps(): ProcessPromptDeps {
  return {
    bot: {} as Bot<Context>,
    ensureEventSubscription: vi.fn(),
  };
}

describe("bot/commands/skills", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");

    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Repo",
    };

    mocked.commandListMock.mockReset();
    mocked.processUserPromptMock.mockReset();
    mocked.processUserPromptMock.mockResolvedValue(true);
  });

  it("shows skills list and starts custom interaction", async () => {
    mocked.commandListMock.mockResolvedValue({
      data: [
        { name: "borsch", description: "Cook borsch", source: "skill" },
        { name: "release", description: "Prepare release", source: "skill" },
      ],
      error: null,
    });

    const ctx = createCommandContext(123);
    await skillsCommand(ctx as never);

    expect(mocked.commandListMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("skills:select:0");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("skills:select:1");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("skills:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.flow).toBe("skills");
    expect(state?.metadata.stage).toBe("list");
    expect(state?.metadata.messageId).toBe(123);
  });

  it("filters out non-skill sources from skill list", async () => {
    mocked.commandListMock.mockResolvedValue({
      data: [
        { name: "borsch", description: "Cook borsch", source: "skill" },
        { name: "release", description: "Prepare release", source: "skill" },
        { name: "review", description: "Review changes", source: "command" },
        { name: "from-mcp", description: "MCP prompt", source: "mcp" },
      ],
      error: null,
    });

    const ctx = createCommandContext(124);
    await skillsCommand(ctx as never);

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.metadata.skills).toEqual([
      { name: "borsch", description: "Cook borsch" },
      { name: "release", description: "Prepare release" },
    ]);
  });

  it("transitions to confirmation step after selecting skill", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "skills",
        stage: "list",
        messageId: 321,
        projectDirectory: "D:\\Projects\\Repo",
        skills: [
          { name: "borsch", description: "Cook borsch" },
          { name: "release", description: "Prepare release" },
        ],
      },
    });

    const callbackCtx = createCallbackContext("skills:select:1", 321);
    const handled = await handleSkillsCallback(callbackCtx, createDeps());

    expect(handled).toBe(true);
    expect(callbackCtx.editMessageText).toHaveBeenCalledWith(
      t("skills.confirm", { skill: "/release" }),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("mixed");
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.skillName).toBe("release");
  });

  it("executes selected skill from callback via prompt flow", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "skills",
        stage: "confirm",
        messageId: 400,
        projectDirectory: "D:\\Projects\\Repo",
        skillName: "borsch",
      },
    });

    const ctx = createCallbackContext("skills:execute", 400);
    const deps = createDeps();
    const handled = await handleSkillsCallback(ctx, deps);

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith(`${t("skills.executing_prefix")}\n/borsch`, {
      entities: [{ type: "code", offset: t("skills.executing_prefix").length + 1, length: 7 }],
    });
    expect(mocked.processUserPromptMock).toHaveBeenCalledWith(ctx, "/borsch", deps);
  });

  it("executes selected skill with arguments from text message", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: {
        flow: "skills",
        stage: "confirm",
        messageId: 500,
        projectDirectory: "D:\\Projects\\Repo",
        skillName: "borsch",
      },
    });

    const ctx = createTextContext("with garlic buns");
    const deps = createDeps();
    const handled = await handleSkillTextArguments(ctx, deps);

    expect(handled).toBe(true);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(ctx.api.deleteMessage).toHaveBeenCalledWith(777, 500);
    expect(ctx.reply).toHaveBeenCalledWith(
      `${t("skills.executing_prefix")}\n/borsch with garlic buns`,
      {
        entities: [{ type: "code", offset: t("skills.executing_prefix").length + 1, length: 7 }],
      },
    );
    expect(mocked.processUserPromptMock).toHaveBeenCalledWith(
      ctx,
      "/borsch with garlic buns",
      deps,
    );
  });

  it("handles stale callback as inactive", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "skills",
        stage: "list",
        messageId: 600,
        projectDirectory: "D:\\Projects\\Repo",
        skills: [{ name: "borsch", description: "Cook borsch" }],
      },
    });

    const ctx = createCallbackContext("skills:cancel", 999);
    const handled = await handleSkillsCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("skills.inactive_callback"),
      show_alert: true,
    });
    expect(interactionManager.getSnapshot()?.kind).toBe("custom");
  });

  it("handles next-page callback and renders second page", async () => {
    const skills = Array.from({ length: 12 }, (_, i) => ({
      name: `skill${i + 1}`,
      description: `Skill ${i + 1} description`,
    }));

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "skills",
        stage: "list",
        messageId: 800,
        projectDirectory: "D:\\Projects\\Repo",
        skills,
        page: 0,
      },
    });

    const ctx = createCallbackContext("skills:page:1", 800);
    const handled = await handleSkillsCallback(ctx, createDeps());

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];

    expect(text).toBe(t("skills.select_page", { page: 2 }));

    const inlineRows = options.reply_markup.inline_keyboard;
    expect(inlineRows[0]?.[0]?.callback_data).toBe("skills:select:10");
    expect(inlineRows[1]?.[0]?.callback_data).toBe("skills:select:11");

    const paginationRow = inlineRows[2];
    expect(paginationRow?.[0]?.callback_data).toBe("skills:page:0");
    expect(paginationRow?.[0]?.text).toBe(t("skills.button.prev_page"));
  });
});

describe("skills pagination helpers", () => {
  describe("parseSkillPageCallback", () => {
    it("parses valid page callbacks", () => {
      expect(parseSkillPageCallback("skills:page:0")).toBe(0);
      expect(parseSkillPageCallback("skills:page:12")).toBe(12);
    });

    it("returns null for non-page callbacks", () => {
      expect(parseSkillPageCallback("skills:select:0")).toBeNull();
      expect(parseSkillPageCallback("skills:page:-1")).toBeNull();
      expect(parseSkillPageCallback("skills:page:abc")).toBeNull();
      expect(parseSkillPageCallback("skills:cancel")).toBeNull();
    });
  });

  describe("formatSkillsSelectText", () => {
    it("returns base text for first page", () => {
      expect(formatSkillsSelectText(0)).toBe("Choose an OpenCode skill:");
    });

    it("returns page-specific text for subsequent pages", () => {
      expect(formatSkillsSelectText(1)).toBe("Choose an OpenCode skill (page 2):");
    });
  });

  describe("calculateSkillsPaginationRange", () => {
    it("returns first page bounds", () => {
      expect(calculateSkillsPaginationRange(25, 0, 10)).toEqual({
        page: 0,
        totalPages: 3,
        startIndex: 0,
        endIndex: 10,
      });
    });

    it("clamps page to valid range", () => {
      expect(calculateSkillsPaginationRange(25, 99, 10)).toEqual({
        page: 2,
        totalPages: 3,
        startIndex: 20,
        endIndex: 25,
      });
    });
  });
});
