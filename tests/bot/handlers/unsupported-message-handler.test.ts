import { describe, expect, it, vi } from "#vitest";
import type { Mock } from "#vitest";
import type { Context } from "grammy";

const warnMock = vi.hoisted(() => vi.fn());

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
  },
}));

import { loadSut } from "#helpers/sut-loader.js";

const { handleUnsupportedMessage, handleUnsupportedMessages } = await loadSut<
  typeof import("#src/bot/handlers/unsupported-message-handler.js")
>("#src/bot/handlers/unsupported-message-handler.ts", import.meta.url);
const { t } = await loadSut<typeof import("#src/i18n/index.js")>(
  "#src/i18n/index.ts",
  import.meta.url,
);

function createContext(field: string, value: unknown = {}): {
  ctx: Context;
  reply: Mock;
} {
  const reply = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    chat: { id: 42 },
    message: {
      message_id: 7,
      date: 1,
      chat: { id: 42, type: "private" },
      [field]: value,
    },
    reply,
  } as unknown as Context;
  return { ctx, reply };
}

describe("bot/handlers/unsupported-message-handler", () => {
  it.each(["video", "sticker", "animation", "video_note", "location", "contact", "poll"])(
    "replies once and logs carried fields for %s",
    async (field) => {
      warnMock.mockClear();
      const { ctx, reply } = createContext(field);

      await expect(handleUnsupportedMessage(ctx)).resolves.toBe(true);

      expect(reply).toHaveBeenCalledOnce();
      expect(reply).toHaveBeenCalledWith(t("bot.message_type_unsupported"));
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining(`types=${field}`),
      );
      expect(warnMock).toHaveBeenCalledWith(
        expect.stringContaining(
          `fields=${["chat", "date", "message_id", field].sort().join(",")}`,
        ),
      );
    },
  );

  it("aggregates unsupported album items into one reply and warning", async () => {
    warnMock.mockClear();
    const first = createContext("video");
    const second = createContext("animation");

    await expect(handleUnsupportedMessages([first.ctx, second.ctx])).resolves.toBe(true);

    expect(first.reply).toHaveBeenCalledOnce();
    expect(second.reply).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledOnce();
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining("types=video,animation"));
  });

  it("keeps Telegram service messages silent", async () => {
    warnMock.mockClear();
    const { ctx, reply } = createContext("pinned_message", { message_id: 6 });

    await expect(handleUnsupportedMessage(ctx)).resolves.toBe(false);

    expect(reply).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });
});
