import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundSessionNotification } from "../../../src/app/managers/background-session-manager.js";
import { createBackgroundNoticeDelivery } from "../../../src/bot/events/background-notice-delivery.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getShowBackgroundSessionNotifications: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getShowBackgroundSessionNotifications: mocked.getShowBackgroundSessionNotifications,
}));

const destination = { api: {}, chatId: 42 };
const kinds = ["assistant_response", "question_asked", "permission_asked"] as const;

function notice(kind: BackgroundSessionNotification["kind"]): BackgroundSessionNotification {
  return { kind, sessionId: "session-1", sessionTitle: "Other" };
}

describe("bot/events/background-notice-delivery", () => {
  const sendText = vi.fn();
  const editText = vi.fn();

  beforeEach(() => {
    sendText.mockReset();
    editText.mockReset();
    sendText.mockResolvedValue(1);
    mocked.getShowBackgroundSessionNotifications.mockReset();
    mocked.getShowBackgroundSessionNotifications.mockReturnValue(true);
  });

  function deliver() {
    return createBackgroundNoticeDelivery(
      { getDestination: () => destination as never },
      { sendText, editText } as never,
    );
  }

  it("sends each kind when the setting is on", async () => {
    const send = deliver();

    for (const kind of kinds) {
      await send(notice(kind));
    }

    expect(sendText).toHaveBeenCalledTimes(3);
    expect(editText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      destination,
      t("background.question_asked", { session: "Other" }),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [
            [
              {
                text: t("background.open_session_button"),
                callback_data: "background-session:q:session-1",
              },
            ],
          ],
        }),
      }),
    );
  });

  it("sends when the setting is missing", async () => {
    mocked.getShowBackgroundSessionNotifications.mockReturnValue(true);

    await deliver()(notice("assistant_response"));

    expect(sendText).toHaveBeenCalledOnce();
  });

  it("drops every kind when the setting is off and does not edit a previous message", async () => {
    const send = deliver();
    await send(notice("assistant_response"));
    mocked.getShowBackgroundSessionNotifications.mockReturnValue(false);

    for (const kind of kinds) {
      await send(notice(kind));
    }

    expect(sendText).toHaveBeenCalledOnce();
    expect(editText).not.toHaveBeenCalled();
  });
});
