import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  isForegroundBusyMock: vi.fn(),
  replyBusyBlockedMock: vi.fn(),
  showModelSelectionMenuMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/app/services/run-control-service.js", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
}));

vi.mock("../../../src/bot/messages/busy-blocked-renderer.js", () => ({
  replyBusyBlocked: mocked.replyBusyBlockedMock,
}));

vi.mock("../../../src/bot/menus/model-selection-menu.js", () => ({
  showModelSelectionMenu: mocked.showModelSelectionMenuMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocked.loggerErrorMock,
  },
}));

import { modelsCommand } from "../../../src/bot/commands/models.js";

function createCommandContext() {
  return {
    chat: { id: 123 },
    reply: vi.fn().mockResolvedValue({ message_id: 999 }),
  } as unknown as Context;
}

describe("bot/commands/models", () => {
  beforeEach(() => {
    mocked.isForegroundBusyMock.mockReset().mockReturnValue(false);
    mocked.replyBusyBlockedMock.mockReset().mockResolvedValue(undefined);
    mocked.showModelSelectionMenuMock.mockReset().mockResolvedValue(undefined);
    mocked.loggerErrorMock.mockReset();
  });

  it("opens the model selection menu", async () => {
    const ctx = createCommandContext();

    await modelsCommand(ctx as never);

    expect(mocked.showModelSelectionMenuMock).toHaveBeenCalledWith(ctx);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("blocks the command while the foreground session is busy", async () => {
    mocked.isForegroundBusyMock.mockReturnValue(true);
    const ctx = createCommandContext();

    await modelsCommand(ctx as never);

    expect(mocked.replyBusyBlockedMock).toHaveBeenCalledWith(ctx);
    expect(mocked.showModelSelectionMenuMock).not.toHaveBeenCalled();
  });

  it("reports an error when the model menu cannot be shown", async () => {
    mocked.showModelSelectionMenuMock.mockRejectedValue(new Error("menu failed"));
    const ctx = createCommandContext();

    await modelsCommand(ctx as never);

    expect(mocked.loggerErrorMock).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("model.menu.error"));
  });
});
