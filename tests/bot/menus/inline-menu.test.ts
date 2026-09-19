import { beforeEach, describe, expect, it, vi } from "vitest";
import { Context, InlineKeyboard } from "grammy";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../../../src/bot/menus/inline-menu.js";
import { handleInlineMenuCancel } from "../../../src/bot/callbacks/inline-menu-cancel-callback-handler.js";
import { t } from "../../../src/i18n/index.js";
import { defined } from "../../helpers/defined.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

let deps: AppContainer;

function createReplyContext(messageId: number = 1): Context {
  return {
    chat: { id: 100 },
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number): Context {
  return {
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function getCallbackData(button: unknown): string | undefined {
  if (!button || typeof button !== "object") {
    return undefined;
  }

  const maybeButton = button as { callback_data?: string };
  return maybeButton.callback_data;
}

beforeEach(() => {
  deps = createTestAppContainer();
});

describe("bot/menus/inline-menu", () => {
  beforeEach(() => {
    deps.interactionManager.clear("test_setup");
  });

  it("adds unified cancel button to inline keyboard", () => {
    const keyboard = new InlineKeyboard().text("Project A", "project:1");

    appendInlineMenuCancelButton(keyboard, "project");

    const rows = keyboard.inline_keyboard;
    const lastRow = defined(rows[rows.length - 1]);

    expect(defined(lastRow[0]).text).toBe(t("inline.button.cancel"));
    expect(getCallbackData(defined(lastRow[0]))).toBe("inline:cancel:project");
  });

  it("uses close label for settings menu", () => {
    const keyboard = new InlineKeyboard().text("Compact output", "settings:compact_output");

    appendInlineMenuCancelButton(keyboard, "settings");

    const rows = keyboard.inline_keyboard;
    const lastRow = defined(rows[rows.length - 1]);

    expect(defined(lastRow[0]).text).toBe(t("inline.button.close"));
    expect(getCallbackData(defined(lastRow[0]))).toBe("inline:cancel:settings");
  });

  it("does not create empty rows when keyboard already has trailing row separator", () => {
    const keyboard = new InlineKeyboard().text("Project A", "project:1").row();

    appendInlineMenuCancelButton(keyboard, "project");

    expect(keyboard.inline_keyboard.some((row) => row.length === 0)).toBe(false);
    expect(getCallbackData(keyboard.inline_keyboard[1]?.[0])).toBe("inline:cancel:project");
  });

  it("replies with inline menu and registers active interaction state", async () => {
    const ctx = createReplyContext(42);
    const keyboard = new InlineKeyboard().text("Model A", "model:openai:gpt-4o");

    await replyWithInlineMenu(ctx, {
      menuKind: "model",
      text: "Select model",
      keyboard,
      metadata: {
        modelLists: {
          favorites: [{ providerID: "openai", modelID: "gpt-4o" }],
          recent: [],
        },
      },
    }, deps);

    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const call = defined((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]);
    const [, options] = call;
    const replyMarkup = options.reply_markup as InlineKeyboard;
    const lastRow = defined(replyMarkup.inline_keyboard[replyMarkup.inline_keyboard.length - 1]);

    expect(getCallbackData(defined(lastRow[0]))).toBe("inline:cancel:model");

    const state = deps.interactionManager.getSnapshot();
    expect(state?.kind).toBe("inline");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.menuKind).toBe("model");
    expect(state?.metadata.messageId).toBe(42);
    expect(state?.metadata.modelLists).toEqual({
      favorites: [{ providerID: "openai", modelID: "gpt-4o" }],
      recent: [],
    });
  });

  it("accepts callback from active inline menu", async () => {
    deps.interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "session",
        messageId: 99,
      },
    });

    const ctx = createCallbackContext("session:abc", 99);

    const result = await ensureActiveInlineMenu(ctx, "session", deps);

    expect(result).toBe(true);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("rejects stale callback when menu kind does not match", async () => {
    deps.interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "project",
        messageId: 10,
      },
    });

    const ctx = createCallbackContext("session:abc", 10);

    const result = await ensureActiveInlineMenu(ctx, "session", deps);

    expect(result).toBe(false);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
  });

  it("handles unified inline cancel callback and clears state", async () => {
    deps.interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "variant",
        messageId: 777,
      },
    });

    const ctx = createCallbackContext("inline:cancel:variant", 777);

    const handled = await handleInlineMenuCancel(ctx, deps);

    expect(handled).toBe(true);
    expect(deps.interactionManager.getSnapshot()).toBeNull();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("common.cancelled") });
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
  });

  it("supports legacy compact cancel callback", async () => {
    deps.interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "context",
        messageId: 555,
      },
    });

    const ctx = createCallbackContext("compact:cancel", 555);

    const handled = await handleInlineMenuCancel(ctx, deps);

    expect(handled).toBe(true);
    expect(deps.interactionManager.getSnapshot()).toBeNull();
  });
});
