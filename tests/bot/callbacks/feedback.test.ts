import { beforeEach, describe, expect, it, vi } from "#vitest";
import type { Context, Keyboard } from "grammy";
import {
  alert,
  cancelMenu,
  cancelPrompt,
  failure,
  notify,
  switched,
} from "../../../src/bot/callbacks/feedback.js";
import { t } from "../../../src/i18n/index.js";
import { logger } from "../../../src/utils/logger.js";
import { defined } from "../../helpers/defined.js";

function createContext(): Context {
  return {
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("callback feedback helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("notify answers with a toast", async () => {
    const ctx = createContext();

    await notify(ctx, "common.cancelled");

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("common.cancelled") });
  });

  it("alert answers with a modal", async () => {
    const ctx = createContext();

    await alert(ctx, "projects.empty");

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("projects.empty"),
      show_alert: true,
    });
  });

  it("notify interpolates params", async () => {
    const ctx = createContext();

    await notify(ctx, "model.changed_message", { name: "sonnet" });

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("model.changed_message", { name: "sonnet" }),
    });
  });

  it("failure swallows a rejected answer instead of throwing", async () => {
    const ctx = createContext();
    vi.mocked(ctx.answerCallbackQuery).mockRejectedValue(new Error("query is too old"));

    await expect(failure(ctx, "projects.select_error")).resolves.toBeUndefined();
  });

  it("notify does not swallow a rejected answer", async () => {
    const ctx = createContext();
    vi.mocked(ctx.answerCallbackQuery).mockRejectedValue(new Error("query is too old"));

    await expect(notify(ctx, "projects.select_error")).rejects.toThrow("query is too old");
  });

  it("switched answers without text, sends the keyboard, then drops the menu", async () => {
    const ctx = createContext();
    const keyboard = {} as Keyboard;
    const order: string[] = [];
    vi.mocked(ctx.answerCallbackQuery).mockImplementation(async () => {
      order.push("answer");
      return true;
    });
    vi.mocked(ctx.reply).mockImplementation(async () => {
      order.push("reply");
      return undefined as never;
    });
    vi.mocked(ctx.deleteMessage).mockImplementation(async () => {
      order.push("delete");
      return true;
    });

    await switched(ctx, "Model changed to: sonnet", keyboard);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(ctx.reply).toHaveBeenCalledWith("Model changed to: sonnet", {
      reply_markup: keyboard,
    });
    expect(order).toEqual(["answer", "reply", "delete"]);
  });

  it("cancelMenu answers before deleting the menu message", async () => {
    const ctx = createContext();
    const order: string[] = [];
    vi.mocked(ctx.answerCallbackQuery).mockImplementation(async () => {
      order.push("answer");
      return true;
    });
    vi.mocked(ctx.deleteMessage).mockImplementation(async () => {
      order.push("delete");
      return true;
    });

    await cancelMenu(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("common.cancelled") });
    expect(order).toEqual(["answer", "delete"]);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("cancelPrompt answers before replacing the prompt text", async () => {
    const ctx = createContext();
    const order: string[] = [];
    vi.mocked(ctx.answerCallbackQuery).mockImplementation(async () => {
      order.push("answer");
      return true;
    });
    vi.mocked(ctx.editMessageText).mockImplementation(async () => {
      order.push("edit");
      return true as never;
    });

    await cancelPrompt(ctx, "rename.cancelled");

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("common.cancelled") });
    expect(ctx.editMessageText).toHaveBeenCalledWith(t("rename.cancelled"));
    expect(order).toEqual(["answer", "edit"]);
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  it("truncates an answer longer than the Telegram limit and warns", async () => {
    const ctx = createContext();
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const longName = "x".repeat(300);

    await notify(ctx, "model.changed_message", { name: longName });

    const call = defined(vi.mocked(ctx.answerCallbackQuery).mock.calls[0]);
    const [payload] = call;
    expect((payload as { text: string }).text).toHaveLength(200);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("model.changed_message"));
  });
});
