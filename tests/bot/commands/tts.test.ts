import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { ttsCommand } from "../../../src/bot/commands/tts.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  isTtsEnabledMock: vi.fn(),
  setTtsEnabledMock: vi.fn(),
  isTtsConfiguredMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  isTtsEnabled: mocked.isTtsEnabledMock,
  setTtsEnabled: mocked.setTtsEnabledMock,
}));

vi.mock("../../../src/tts/client.js", () => ({
  isTtsConfigured: mocked.isTtsConfiguredMock,
}));

describe("bot/commands/tts", () => {
  beforeEach(() => {
    mocked.isTtsEnabledMock.mockReset();
    mocked.setTtsEnabledMock.mockReset();
    mocked.isTtsConfiguredMock.mockReset();
  });

  it("enables TTS replies for the current chat", async () => {
    mocked.isTtsEnabledMock.mockReturnValue(false);
    mocked.isTtsConfiguredMock.mockReturnValue(true);
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/tts" },
      reply: replyMock,
    } as unknown as Context;

    await ttsCommand(ctx as never);

    expect(mocked.setTtsEnabledMock).toHaveBeenCalledWith(true);
    expect(replyMock).toHaveBeenCalledWith(t("tts.enabled"));
  });

  it("disables TTS replies for the current chat", async () => {
    mocked.isTtsEnabledMock.mockReturnValue(true);
    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      chat: { id: 42, type: "private" },
      message: { text: "/tts" },
      reply: replyMock,
    } as unknown as Context;

    await ttsCommand(ctx as never);

    expect(mocked.setTtsEnabledMock).toHaveBeenCalledWith(false);
    expect(replyMock).toHaveBeenCalledWith(t("tts.disabled"));
  });
});
