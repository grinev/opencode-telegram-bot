import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildExternalUserInputNotification,
  deliverExternalUserInputNotification,
} from "../../../src/bot/utils/external-user-input.js";

const mocked = vi.hoisted(() => ({
  sendBotTextMock: vi.fn(),
}));

vi.mock("../../../src/bot/utils/telegram-text.js", () => ({
  sendBotText: mocked.sendBotTextMock,
}));

describe("bot/utils/external-user-input", () => {
  beforeEach(() => {
    mocked.sendBotTextMock.mockReset();
    mocked.sendBotTextMock.mockResolvedValue(undefined);
  });

  it("builds a quoted notification with fallback text", () => {
    const notification = buildExternalUserInputNotification("Line 1\nLine 2");

    expect(notification).toEqual({
      text: expect.stringContaining("External user input"),
      rawFallbackText: "External user input\n\n> Line 1\n> Line 2",
    });
  });

  it("sends external user input when session matches and it is not suppressed", async () => {
    const delivered = await deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-1",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput: vi.fn().mockReturnValue(false),
    });

    expect(delivered).toBe(true);
    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        format: "markdown_v2",
        rawFallbackText: "External user input\n\n> Review the parser",
      }),
    );
  });

  it("does not send notification when input is suppressed", async () => {
    const consumeSuppressedInput = vi.fn().mockReturnValue(true);

    const delivered = await deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-1",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput,
    });

    expect(delivered).toBe(false);
    expect(consumeSuppressedInput).toHaveBeenCalledWith("session-1", "Review the parser");
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();
  });

  it("does not send notification when the current session differs", async () => {
    const delivered = await deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-2",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput: vi.fn().mockReturnValue(false),
    });

    expect(delivered).toBe(false);
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();
  });
});
