import { beforeEach, describe, expect, it, vi } from "vitest";

const withdrawInboxPromptMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/app/services/prompt-inbox-service.js", () => ({
  withdrawInboxPrompt: withdrawInboxPromptMock,
}));

import { registerMessageRouter } from "../../../src/bot/routers/message-router.js";
import { QUEUED_PROMPT_BUTTON_TEXT_PATTERN } from "../../../src/bot/message-patterns.js";
import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";

describe("bot/routers/message-router", () => {
  it("registers reply keyboard, media, and text routes", () => {
    const bot = {
      on: vi.fn(),
      hears: vi.fn(),
    };

    registerMessageRouter(bot as never, {
      container: createTestAppContainer({ ensureEventSubscription: vi.fn(), setTelegramContext: vi.fn() }),
    });

    expect(bot.hears).toHaveBeenCalledTimes(5);
    // The queued prompt route must win over the other reply keyboard routes.
    expect(defined(bot.hears.mock.calls[0]?.[0])).toBe(QUEUED_PROMPT_BUTTON_TEXT_PATTERN);
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

  describe("queued prompt button handler", () => {
    function registerAndGetQueuedPromptHandler() {
      const bot = { on: vi.fn(), hears: vi.fn() };

      registerMessageRouter(bot as never, {
        container: createTestAppContainer({ ensureEventSubscription: vi.fn(), setTelegramContext: vi.fn() }),
      });

      return defined(bot.hears.mock.calls[0]?.[1]) as (ctx: unknown, next: () => Promise<void>) => Promise<void>;
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
