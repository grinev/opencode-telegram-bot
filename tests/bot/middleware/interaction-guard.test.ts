import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, NextFunction } from "grammy";
import { interactionGuardMiddleware } from "../../../src/bot/middleware/interaction-guard.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

function createTextContext(text: string): Context {
  return {
    chat: { id: 1 },
    message: { text } as Context["message"],
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createCallbackContext(data: string): Context {
  return {
    callbackQuery: { data } as Context["callbackQuery"],
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("interactionGuardMiddleware", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
  });

  it("passes through when there is no active interaction", async () => {
    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("blocks text and replies when callback is expected", async () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
    });

    const ctx = createTextContext("hello");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("interaction.blocked.expected_callback"));
  });

  it("blocks callback and answers callback query when text is expected", async () => {
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
    });

    const ctx = createCallbackContext("rename:cancel");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("interaction.blocked.expected_text"),
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("allows command from allowed list", async () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const ctx = createTextContext("/status");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("blocks disallowed command", async () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const ctx = createTextContext("/help");
    const next: NextFunction = vi.fn().mockResolvedValue(undefined);

    await interactionGuardMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("interaction.blocked.command_not_allowed"));
  });
});
