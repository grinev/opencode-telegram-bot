import { beforeEach, describe, expect, it, vi } from "vitest";

const withdrawInboxPromptMock = vi.hoisted(() => vi.fn());
const loadCommandCatalogMock = vi.hoisted(() => vi.fn());
const loadSkillsCatalogMock = vi.hoisted(() => vi.fn());
const queuePromptForMergingMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/app/services/prompt-inbox-service.js", () => ({
  withdrawInboxPrompt: withdrawInboxPromptMock,
}));

vi.mock("../../../src/app/services/command-catalog-service.js", () => ({
  loadCommandCatalog: loadCommandCatalogMock,
}));

vi.mock("../../../src/app/services/skills-catalog-service.js", () => ({
  loadSkillsCatalog: loadSkillsCatalogMock,
}));

vi.mock("../../../src/bot/handlers/message-merger.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/bot/handlers/message-merger.js")>()),
  queuePromptForMerging: queuePromptForMergingMock,
}));

import { registerMessageRouter } from "../../../src/bot/routers/message-router.js";
import { GOAL_BUTTON_TEXT_PATTERN, QUEUED_PROMPT_BUTTON_TEXT_PATTERN } from "../../../src/bot/message-patterns.js";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";
import { setIncomingPrompt } from "../../../src/bot/handlers/rich-message-handler.js";
import * as settingsStore from "../../../src/app/stores/settings-store.js";

describe("bot/routers/message-router", () => {
  it("registers reply keyboard, media, and text routes", () => {
    const bot = {
      on: vi.fn(),
      hears: vi.fn(),
    };

    registerMessageRouter(bot as never, {
      container: createTestAppContainer({ ensureEventSubscription: vi.fn(), setTelegramContext: vi.fn() }),
    });

    expect(bot.hears).toHaveBeenCalledTimes(6);
    expect(defined(bot.hears.mock.calls[0]?.[0])).toBe(GOAL_BUTTON_TEXT_PATTERN);
    expect(defined(bot.hears.mock.calls[1]?.[0])).toBe(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
    expect(bot.on.mock.calls.map(([event]) => event)).toEqual([
      "message:text",
      "message:text",
      "message:voice",
      "message:audio",
      "message",
      "message:photo",
      "message:document",
      "message:text",
      "message",
    ]);
  });

  it.each([
    ["commands", "command"],
    ["commands", "/help"],
    ["skills", "skill"],
    ["skills", "/help"],
  ] as const)(
    "routes %s-search input %s without sending a prompt",
    async (catalog, text) => {
      const bot = { on: vi.fn(), hears: vi.fn() };
      const container = createTestAppContainer({ setTelegramContext: vi.fn() });
      container.interactionManager.start({
        kind: "custom",
        expectedInput: "text",
        allowedCommands: [],
        metadata: { flow: `${catalog}-search`, stage: "input", token: Symbol("search") },
      });
      const project = vi.spyOn(settingsStore, "getCurrentProject").mockReturnValue({
        id: "project-1",
        worktree: "repo",
      });
      loadCommandCatalogMock.mockReset().mockResolvedValue([{ name: "command" }]);
      loadSkillsCatalogMock.mockReset().mockResolvedValue([{ name: "skill" }]);
      const loadCatalogMock = catalog === "skills" ? loadSkillsCatalogMock : loadCommandCatalogMock;
      queuePromptForMergingMock.mockReset();
      registerMessageRouter(bot as never, { container });
      const handler = bot.on.mock.calls
        .filter(([event]) => event === "message:text")
        .at(-1)?.[1] as (ctx: unknown) => Promise<void>;
      const ctx = {
        chat: { id: 42 },
        message: { text },
        reply: vi.fn().mockResolvedValue({ message_id: 900 }),
      };
      setIncomingPrompt(ctx as never, createIncomingPrompt(text));
      try {
        await handler(ctx);
        if (text.startsWith("/")) {
          expect(loadCommandCatalogMock).not.toHaveBeenCalled();
          expect(loadSkillsCatalogMock).not.toHaveBeenCalled();
          expect(ctx.reply).not.toHaveBeenCalled();
          expect(container.interactionManager.getSnapshot()?.metadata.stage).toBe("input");
        } else {
          expect(loadCatalogMock).toHaveBeenCalledWith("repo");
          expect(ctx.reply).toHaveBeenCalledWith(
            t(catalog === "skills" ? "skills.search.results" : "commands.search.results", { query: text }),
            expect.anything(),
          );
          expect(container.interactionManager.getSnapshot()?.metadata.stage).toBe("results");
        }
        expect(queuePromptForMergingMock).not.toHaveBeenCalled();
      } finally {
        project.mockRestore();
      }
    },
  );

  describe("queued prompt button handler", () => {
    function registerAndGetQueuedPromptHandler() {
      const bot = { on: vi.fn(), hears: vi.fn() };

      registerMessageRouter(bot as never, {
        container: createTestAppContainer({ ensureEventSubscription: vi.fn(), setTelegramContext: vi.fn() }),
      });

      return defined(bot.hears.mock.calls[1]?.[1]) as (ctx: unknown, next: () => Promise<void>) => Promise<void>;
    }

    function makeButtonContext(text: string) {
      return {
        chat: { id: 42 },
        message: { text },
        reply: vi.fn().mockResolvedValue(undefined),
      };
    }

    beforeEach(() => {
      promptQueue.__resetForTests();
    });

    it("removes the pressed prompt from the middle of the queue", async () => {
      promptQueue.add(createIncomingPrompt("first"));
      promptQueue.add(createIncomingPrompt("second"));
      promptQueue.add(createIncomingPrompt("third"));
      const handler = registerAndGetQueuedPromptHandler();
      const ctx = makeButtonContext("❌ 2. second");
      const next = vi.fn();

      await handler(ctx, next);

      expect(promptQueue.list().map((item) => item.text)).toEqual(["first", "third"]);
      expect(ctx.reply).toHaveBeenCalledWith(t("queue.removed"), expect.anything());
      expect(next).not.toHaveBeenCalled();
    });

    it("never forwards a stale button label to OpenCode when the queue is empty", async () => {
      const handler = registerAndGetQueuedPromptHandler();
      const ctx = makeButtonContext("❌ 1. cleared by abort");
      const next = vi.fn();

      await handler(ctx, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(t("queue.not_found"), expect.anything());
    });

    it.each([
      { result: "removed", replyKey: "queue.removed" },
      { result: "gone", replyKey: "queue.not_found" },
      { result: "failed", replyKey: "bot.prompt_send_error" },
    ] as const)(
      "withdraws a prompt waiting in OpenCode and answers $replyKey when it is $result",
      async ({ result, replyKey }) => {
        const item = promptQueue.confirmReservation(promptQueue.reserve()!, {
          displayText: "steered",
          inbox: { sessionId: "ses-1", inboxId: "msg-1", delivery: "steer" },
        });
        withdrawInboxPromptMock.mockReset().mockResolvedValue(result);
        const handler = registerAndGetQueuedPromptHandler();
        const ctx = makeButtonContext("❌ 1. steered");

        await handler(ctx, vi.fn());

        expect(withdrawInboxPromptMock).toHaveBeenCalledWith(item);
        expect(ctx.reply).toHaveBeenCalledWith(t(replyKey), expect.anything());
      },
    );

    it("answers not_found when the label no longer matches the queue", async () => {
      promptQueue.add(createIncomingPrompt("still queued"));
      const handler = registerAndGetQueuedPromptHandler();
      const ctx = makeButtonContext("❌ 3. already gone");
      const next = vi.fn();

      await handler(ctx, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(t("queue.not_found"), expect.anything());
      expect(promptQueue.size()).toBe(1);
    });
  });
});
