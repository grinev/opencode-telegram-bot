import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Context } from "grammy";
import { skillsCommand } from "../../../src/bot/commands/skills-catalog-command.js";
import {
  handleSkillsCallback,
  handleSkillsSearchTextInput,
} from "../../../src/bot/callbacks/skills-catalog-callback-handler.js";
import { handleSkillTextArguments } from "../../../src/bot/handlers/text-message-handler.js";
import {
  calculateSkillsPaginationRange,
  filterSkillsForSearch,
  formatSkillsSelectText,
  parseSkillPageCallback,
} from "../../../src/bot/menus/skills-catalog-menu.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { ProcessPromptDeps } from "../../../src/bot/handlers/prompt.js";
import type { ExecuteCommandDeps } from "../../../src/bot/callbacks/command-catalog-callback-handler.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";
import { startInteractionForTest } from "../../helpers/interaction.js";

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
  processUserPrompt: (ctx: Context, input: { text: string }, deps: ProcessPromptDeps) =>
    mocked.processUserPromptMock(ctx, input.text, deps),
  clearPromptResponseMode: vi.fn(),
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

function createDeps(): ExecuteCommandDeps {
  return {
    ...container, ensureEventSubscription: vi.fn(),
    bot: {} as Bot<Context>,
  };
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/commands/skills", () => {
  beforeEach(() => {
    container.interactionManager.clear("test_setup");

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
    await skillsCommand(ctx as never, createDeps());

    expect(mocked.commandListMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [, options] = defined((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]) as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> } },
    ];
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("skills:search");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("skills:select:0");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("skills:select:1");
    expect(options.reply_markup.inline_keyboard[3]?.[0]?.callback_data).toBe("skills:cancel");

    const state = container.interactionManager.getSnapshot();
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
    await skillsCommand(ctx as never, createDeps());

    const state = container.interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.metadata.skills).toEqual([
      { name: "borsch", description: "Cook borsch" },
      { name: "release", description: "Prepare release" },
    ]);
  });

  it("transitions to confirmation step after selecting skill", async () => {
    container.interactionManager.start({
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

    const state = container.interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("mixed");
    expect(state?.metadata.stage).toBe("confirm");
    expect(state?.metadata.skillName).toBe("release");
  });

  it("executes selected skill from callback via prompt flow", async () => {
    container.interactionManager.start({
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
    expect(container.interactionManager.getSnapshot()).toBeNull();
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith(`${t("skills.executing_prefix")}\n/borsch`, {
      entities: [{ type: "code", offset: t("skills.executing_prefix").length + 1, length: 7 }],
    });
    expect(mocked.processUserPromptMock).toHaveBeenCalledWith(ctx, "/borsch", deps);
  });

  it("executes selected skill with arguments from text message", async () => {
    container.interactionManager.start({
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
    expect(container.interactionManager.getSnapshot()).toBeNull();
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
    container.interactionManager.start({
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
    expect(container.interactionManager.getSnapshot()?.kind).toBe("custom");
  });

  it("handles next-page callback and renders second page", async () => {
    const skills = Array.from({ length: 12 }, (_, i) => ({
      name: `skill${i + 1}`,
      description: `Skill ${i + 1} description`,
    }));

    container.interactionManager.start({
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

    const [text, options] = defined((ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0]) as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string; text: string }>> } },
    ];

    expect(text).toBe(t("skills.select_page", { page: 2 }));

    const inlineRows = options.reply_markup.inline_keyboard;
    expect(inlineRows[0]?.[0]?.callback_data).toBe("skills:search");
    expect(inlineRows[1]?.[0]?.callback_data).toBe("skills:select:10");
    expect(inlineRows[2]?.[0]?.callback_data).toBe("skills:select:11");

    const paginationRow = inlineRows[3];
    expect(paginationRow?.[0]?.callback_data).toBe("skills:page:0");
    expect(paginationRow?.[0]?.text).toBe(t("skills.button.prev_page"));
  });

  describe("search", () => {
    const catalog = Array.from({ length: 12 }, (_, index) => ({
      name: `skill-${index}`,
      description: `Description ${index}`,
      source: "skill",
    }));

    beforeEach(() => {
      mocked.commandListMock.mockResolvedValue({ data: catalog, error: null });
    });

    async function openSearch() {
      await skillsCommand(createCommandContext(100) as never, createDeps());
      const ctx = createCallbackContext("skills:search", 100);
      await handleSkillsCallback(ctx, createDeps());
      return ctx;
    }

    async function showResults(query = "skill") {
      await openSearch();
      const ctx = createTextContext(query);
      await handleSkillsSearchTextInput(ctx, createDeps());
      return ctx;
    }

    it("deletes the list and waits for a query without allowed utility commands", async () => {
      const ctx = await openSearch();
      expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
      expect(ctx.reply).toHaveBeenCalledWith(t("skills.search.prompt"));
      expect(container.interactionManager.getSnapshot()).toMatchObject({
        kind: "custom",
        expectedInput: "text",
        allowedCommands: [],
        metadata: { flow: "skills-search", stage: "input" },
      });
    });

    it("searches full fresh fields, preserves query text and order, and excludes other sources", async () => {
      await openSearch();
      mocked.commandListMock.mockResolvedValueOnce({
        data: [
          { name: "first", description: `${"x".repeat(90)} Needle`, source: "skill" },
          { name: "NEEDLE", source: "skill" },
          { name: "other", description: "not a match", source: "skill" },
          { name: "needle-command", source: "command" },
          { name: "needle-mcp", source: "mcp" },
        ],
        error: null,
      });
      const ctx = createTextContext("  nEeDlE  ");
      expect(await handleSkillsSearchTextInput(ctx, createDeps())).toBe(true);
      expect(mocked.commandListMock).toHaveBeenCalledTimes(2);
      expect(ctx.reply).toHaveBeenCalledWith(
        t("skills.search.results", { query: "  nEeDlE  " }),
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
      expect(container.interactionManager.getSnapshot()).toMatchObject({
        expectedInput: "callback",
        allowedCommands: [],
        metadata: {
          stage: "results",
          query: "  nEeDlE  ",
          skills: [{ name: "first" }, { name: "NEEDLE" }],
          messageId: 903,
        },
      });
      expect(mocked.processUserPromptMock).not.toHaveBeenCalled();
    });

    it("reloads and paginates all matches with the existing page size", async () => {
      await showResults();
      const ctx = createCallbackContext("skills:search:page:1", 903);
      const updated = [...catalog, { name: "skill-new", description: "new", source: "skill" }];
      mocked.commandListMock.mockResolvedValueOnce({ data: updated, error: null });
      await handleSkillsCallback(ctx, createDeps());
      const [text, options] = vi.mocked(ctx.editMessageText).mock.calls[0]!;
      expect(text).toBe(t("skills.search.results_page", { query: "skill", page: 2 }));
      expect(options?.reply_markup?.inline_keyboard).toEqual([
        [expect.objectContaining({ callback_data: "skills:search:result:10" })],
        [expect.objectContaining({ callback_data: "skills:search:result:11" })],
        [expect.objectContaining({ callback_data: "skills:search:result:12" })],
        [expect.objectContaining({ callback_data: "skills:search:page:0" })],
        [
          { text: t("skills.search.again"), callback_data: "skills:search:again" },
          { text: t("skills.search.cancel"), callback_data: "skills:search:cancel" },
        ],
      ]);
      expect(mocked.commandListMock).toHaveBeenCalledTimes(3);
      expect(container.interactionManager.getSnapshot()?.metadata.skills).toHaveLength(13);
    });

    it("shows no results with only search again and cancel", async () => {
      const ctx = await showResults("absent");
      const [text, options] = vi.mocked(ctx.reply).mock.calls[0]!;
      expect(text).toBe(t("skills.search.no_results", { query: "absent" }));
      expect(options?.reply_markup).toMatchObject({
        inline_keyboard: [
          [
            { text: t("skills.search.again"), callback_data: "skills:search:again" },
            { text: t("skills.search.cancel"), callback_data: "skills:search:cancel" },
          ],
        ],
      });
    });

    it("silently waits on whitespace and caps the query including the heading at 100 characters", async () => {
      await openSearch();
      const whitespace = createTextContext("   ");
      const before = container.interactionManager.getSnapshot();
      await handleSkillsSearchTextInput(whitespace, createDeps());
      expect(whitespace.reply).not.toHaveBeenCalled();
      expect(container.interactionManager.getSnapshot()).toEqual(before);
      expect(mocked.commandListMock).toHaveBeenCalledTimes(1);
      const ctx = createTextContext("a".repeat(110));
      await handleSkillsSearchTextInput(ctx, createDeps());
      expect(ctx.reply).toHaveBeenCalledWith(
        t("skills.search.no_results", { query: "a".repeat(100) }),
        expect.anything(),
      );
      expect(container.interactionManager.getSnapshot()?.metadata.query).toHaveLength(100);
    });

    it("starts a new query after deleting results and makes their buttons inactive", async () => {
      await showResults();
      const token = container.interactionManager.getSnapshot()?.metadata.token;
      const ctx = createCallbackContext("skills:search:again", 903);
      await handleSkillsCallback(ctx, createDeps());
      expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
      expect(ctx.reply).toHaveBeenCalledWith(t("skills.search.prompt"));
      expect(container.interactionManager.getSnapshot()?.metadata.stage).toBe("input");
      expect(container.interactionManager.getSnapshot()?.metadata.token).not.toBe(token);
      const stale = createCallbackContext("skills:search:result:0", 903);
      await handleSkillsCallback(stale, createDeps());
      expect(stale.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("inline.inactive_callback"),
        show_alert: true,
      });
    });

    it("cancels without reopening the list", async () => {
      await showResults();
      const ctx = createCallbackContext("skills:search:cancel", 903);
      await handleSkillsCallback(ctx, createDeps());
      expect(container.interactionManager.getSnapshot()).toBeNull();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("common.cancelled") });
      expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it.each(["arguments", "execute"])(
      "selects into the unchanged confirmation before running via %s",
      async (action) => {
        await showResults();
        const deps = createDeps();
        const ctx = createCallbackContext("skills:search:result:11", 903);
        await handleSkillsCallback(ctx, deps);
        expect(ctx.editMessageText).toHaveBeenCalledWith(
          t("skills.confirm", { skill: "/skill-11" }),
          expect.anything(),
        );
        expect(ctx.deleteMessage).not.toHaveBeenCalled();
        expect(mocked.processUserPromptMock).not.toHaveBeenCalled();
        expect(container.interactionManager.getSnapshot()).toMatchObject({
          expectedInput: "mixed",
          allowedCommands: expect.arrayContaining(["/help", "/status", "/abort"]),
          metadata: { flow: "skills", stage: "confirm", skillName: "skill-11", messageId: 903 },
        });
        const execution = action === "arguments"
          ? createTextContext("some arguments")
          : createCallbackContext("skills:execute", 903);
        if (action === "arguments") {
          await handleSkillTextArguments(execution, deps);
        } else {
          await handleSkillsCallback(execution, deps);
        }
        expect(mocked.processUserPromptMock).toHaveBeenCalledWith(
          execution,
          action === "arguments" ? "/skill-11 some arguments" : "/skill-11",
          deps,
        );
      },
    );

    it("clears the search on a catalog error after query entry without deleting the prompt", async () => {
      await openSearch();
      mocked.commandListMock.mockRejectedValueOnce(new Error("offline"));
      const ctx = createTextContext("skill");
      await handleSkillsSearchTextInput(ctx, createDeps());
      expect(ctx.reply).toHaveBeenCalledWith(t("skills.fetch_error"));
      expect(container.interactionManager.getSnapshot()).toBeNull();
      expect(ctx.deleteMessage).not.toHaveBeenCalled();
    });

    it("keeps results available when loading another page fails", async () => {
      await showResults();
      const before = container.interactionManager.getSnapshot();
      mocked.commandListMock.mockRejectedValueOnce(new Error("offline"));
      const ctx = createCallbackContext("skills:search:page:1", 903);
      await handleSkillsCallback(ctx, createDeps());
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("skills.page_load_error_callback"),
      });
      expect(ctx.editMessageText).not.toHaveBeenCalled();
      expect(container.interactionManager.getSnapshot()).toEqual(before);
    });

    it.each(["input", "page"])(
      "keeps the search waiting when a run starts while loading the %s catalog",
      async (stage) => {
        if (stage === "input") await openSearch();
        else await showResults();
        const before = container.interactionManager.getSnapshot();
        mocked.commandListMock.mockImplementationOnce(async () => {
          container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
          return { data: catalog, error: null };
        });
        const ctx = stage === "input"
          ? createTextContext("skill")
          : createCallbackContext("skills:search:page:1", 903);
        if (stage === "input") {
          await handleSkillsSearchTextInput(ctx, createDeps());
          expect(ctx.reply).toHaveBeenCalledExactlyOnceWith(t("bot.session_busy"));
        } else {
          await handleSkillsCallback(ctx, createDeps());
          expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("bot.session_busy") });
          expect(ctx.reply).not.toHaveBeenCalled();
        }
        expect(ctx.editMessageText).not.toHaveBeenCalled();
        expect(container.interactionManager.getSnapshot()).toEqual(before);
        expect(mocked.processUserPromptMock).not.toHaveBeenCalled();
      },
    );

    it.each(["question", "permission"] as const)(
      "does not resume after a %s replaces results",
      async (kind) => {
        await showResults();
        startInteractionForTest(container.interactionManager, { kind, expectedInput: "callback" });
        const before = container.interactionManager.getSnapshot();
        const ctx = createCallbackContext("skills:search:result:0", 903);
        await handleSkillsCallback(ctx, createDeps());
        expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
          text: t("inline.inactive_callback"),
          show_alert: true,
        });
        expect(ctx.editMessageText).not.toHaveBeenCalled();
        expect(ctx.deleteMessage).not.toHaveBeenCalled();
        expect(container.interactionManager.getSnapshot()).toEqual(before);
        container.interactionManager.clear("agent_request_ended");
        expect(await handleSkillsSearchTextInput(createTextContext("skill"), createDeps())).toBe(false);
      },
    );

    it.each([
      "load", "send", "page load", "page edit", "selection edit", "start delete", "again delete",
    ])("does not overwrite a replacement interaction during %s", async (boundary) => {
      const replace = () => startInteractionForTest(container.interactionManager, {
        kind: "permission",
        expectedInput: "callback",
      });
      if (boundary === "start delete") {
        await skillsCommand(createCommandContext(100) as never, createDeps());
        const ctx = createCallbackContext("skills:search", 100);
        vi.mocked(ctx.deleteMessage).mockImplementationOnce(async () => {
          replace();
          return true;
        });
        await handleSkillsCallback(ctx, createDeps());
        expect(ctx.reply).not.toHaveBeenCalled();
      } else if (boundary === "load" || boundary === "send") {
        await openSearch();
        const ctx = createTextContext("skill");
        if (boundary === "load") {
          mocked.commandListMock.mockImplementationOnce(async () => {
            replace();
            return { data: catalog, error: null };
          });
        } else {
          vi.mocked(ctx.reply).mockImplementationOnce(async () => {
            replace();
            return { message_id: 903 } as never;
          });
        }
        await handleSkillsSearchTextInput(ctx, createDeps());
        if (boundary === "load") expect(ctx.reply).not.toHaveBeenCalled();
      } else {
        await showResults();
        const data = boundary === "selection edit"
          ? "result:0"
          : boundary === "again delete" ? "again" : "page:1";
        const ctx = createCallbackContext(`skills:search:${data}`, 903);
        if (boundary === "page load") {
          mocked.commandListMock.mockImplementationOnce(async () => {
            replace();
            return { data: catalog, error: null };
          });
        } else if (boundary === "again delete") {
          vi.mocked(ctx.deleteMessage).mockImplementationOnce(async () => {
            replace();
            return true;
          });
        } else {
          vi.mocked(ctx.editMessageText).mockImplementationOnce(async () => {
            replace();
            return true as never;
          });
        }
        await handleSkillsCallback(ctx, createDeps());
        if (boundary === "page load") expect(ctx.editMessageText).not.toHaveBeenCalled();
      }
      expect(container.interactionManager.getSnapshot()?.kind).toBe("permission");
    });

    it.each(["search", "search:page:1", "search:result:0", "search:again", "search:cancel"])(
      "blocks skills:%s while busy without changing the search",
      async (suffix) => {
        await showResults();
        container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
        const before = container.interactionManager.getSnapshot();
        const ctx = createCallbackContext(`skills:${suffix}`, 903);
        await handleSkillsCallback(ctx, createDeps());
        expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("bot.session_busy") });
        expect(ctx.editMessageText).not.toHaveBeenCalled();
        expect(ctx.deleteMessage).not.toHaveBeenCalled();
        expect(container.interactionManager.getSnapshot()).toEqual(before);
      },
    );

    it.each(["question", "permission"] as const)(
      "preserves a replacement %s when Telegram rejects the result selection edit",
      async (kind) => {
        await showResults();
        const ctx = createCallbackContext("skills:search:result:0", 903);
        vi.mocked(ctx.editMessageText).mockImplementationOnce(async () => {
          startInteractionForTest(container.interactionManager, { kind, expectedInput: "callback" });
          throw new Error("Telegram edit failed");
        });
        await expect(handleSkillsCallback(ctx, createDeps())).resolves.toBe(true);
        expect(container.interactionManager.getSnapshot()?.kind).toBe(kind);
        expect(ctx.deleteMessage).not.toHaveBeenCalled();
        expect(mocked.processUserPromptMock).not.toHaveBeenCalled();
      },
    );

    it("handles a rejected result selection edit while the search still owns the slot", async () => {
      await showResults();
      const ctx = createCallbackContext("skills:search:result:0", 903);
      vi.mocked(ctx.editMessageText).mockRejectedValueOnce(new Error("Telegram edit failed"));
      await expect(handleSkillsCallback(ctx, createDeps())).resolves.toBe(true);
      expect(container.interactionManager.getSnapshot()).toBeNull();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("callback.processing_error") });
      expect(mocked.processUserPromptMock).not.toHaveBeenCalled();
    });

    it("refuses /skills while busy without opening or loading the list", async () => {
      container.foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
      const ctx = createCommandContext(100);
      await skillsCommand(ctx as never, createDeps());
      expect(ctx.reply).toHaveBeenCalledWith(t("bot.session_busy"));
      expect(mocked.commandListMock).not.toHaveBeenCalled();
      expect(container.interactionManager.getSnapshot()).toBeNull();
    });

    it.each(["no project", "empty catalog", "catalog error"])(
      "keeps the initial notice without Search for %s",
      async (reason) => {
        if (reason === "no project") mocked.currentProject = null;
        if (reason === "empty catalog") mocked.commandListMock.mockResolvedValueOnce({ data: [], error: null });
        if (reason === "catalog error") mocked.commandListMock.mockRejectedValueOnce(new Error("offline"));
        const ctx = createCommandContext(100);
        await skillsCommand(ctx as never, createDeps());
        const key = reason === "no project"
          ? "bot.project_not_selected"
          : reason === "empty catalog" ? "skills.empty" : "skills.fetch_error";
        expect(ctx.reply).toHaveBeenCalledWith(t(key));
        expect(container.interactionManager.getSnapshot()).toBeNull();
      },
    );

    it("does not search the no-description placeholder", () => {
      expect(filterSkillsForSearch([{ name: "init" }], t("skills.no_description"))).toEqual([]);
    });
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
