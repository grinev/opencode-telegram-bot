import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundSessionNotification } from "../../../src/app/managers/background-session-manager.js";
import { createBackgroundNoticeDelivery } from "../../../src/bot/events/background-notice-delivery.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getShowBackgroundSessionNotifications: vi.fn(),
  getCurrentProject: vi.fn(),
  fetchSessionTitle: vi.fn(),
  loadRecentSessionDirectories: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getShowBackgroundSessionNotifications: mocked.getShowBackgroundSessionNotifications,
  getCurrentProject: mocked.getCurrentProject,
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  fetchSessionTitle: mocked.fetchSessionTitle,
}));

vi.mock("../../../src/app/services/recent-sessions-service.js", () => ({
  loadRecentSessionDirectories: mocked.loadRecentSessionDirectories,
}));

const destination = { api: {}, chatId: 42 };
const kinds = ["assistant_response", "question_asked", "permission_asked"] as const;

function notice(kind: BackgroundSessionNotification["kind"]): BackgroundSessionNotification {
  return {
    kind,
    sessionId: "session-1",
    sessionTitle: "Other",
    sessionDirectory: "/alpha/other",
  };
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
    mocked.getCurrentProject.mockReset();
    mocked.getCurrentProject.mockReturnValue(undefined);
    mocked.fetchSessionTitle.mockReset();
    mocked.fetchSessionTitle.mockImplementation(async (session: { title: string }) => session.title);
    mocked.loadRecentSessionDirectories.mockReset();
    mocked.loadRecentSessionDirectories.mockResolvedValue(["/alpha/other"]);
  });

  function deliver() {
    return createBackgroundNoticeDelivery(
      { getDestination: () => destination as never },
      { sendText, editText } as never,
    );
  }

  function sentText(index = 0): string {
    return sendText.mock.calls[index]?.[1] as string;
  }

  it("sends each kind when the setting is on", async () => {
    const send = deliver();

    for (const kind of kinds) {
      await send(notice(kind));
    }

    expect(sendText).toHaveBeenCalledTimes(3);
    expect(editText).not.toHaveBeenCalled();
    expect(sentText(0)).toBe(
      t("background.assistant_response", { project: "other", session: "Other" }),
    );
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

  it("names the live title and the project folder in an assistant response", async () => {
    mocked.fetchSessionTitle.mockResolvedValue("Renamed session");

    await deliver()(notice("assistant_response"));

    expect(mocked.fetchSessionTitle).toHaveBeenCalledWith({
      id: "session-1",
      title: "Other",
      directory: "/alpha/other",
    });
    expect(sentText()).toBe(
      t("background.assistant_response", { project: "other", session: "Renamed session" }),
    );
  });

  it("lengthens the project name when another recent folder shares its folder name", async () => {
    mocked.loadRecentSessionDirectories.mockResolvedValue(["/beta/other", "/gamma/other"]);

    await deliver()(notice("assistant_response"));

    expect(sentText()).toBe(
      t("background.assistant_response", { project: "alpha/other", session: "Other" }),
    );
  });

  it("includes the session folder when the recent list does not carry it", async () => {
    mocked.loadRecentSessionDirectories.mockResolvedValue(["/beta/other", "/gamma/unrelated"]);

    await deliver()(notice("assistant_response"));

    expect(sentText()).toBe(
      t("background.assistant_response", { project: "alpha/other", session: "Other" }),
    );
  });

  it("uses the folder name when the recent list cannot be read", async () => {
    mocked.loadRecentSessionDirectories.mockRejectedValue(new Error("offline"));

    await deliver()(notice("assistant_response"));

    expect(sentText()).toBe(
      t("background.assistant_response", { project: "other", session: "Other" }),
    );
  });

  it("names an unnamed session as a new session, never by its id", async () => {
    mocked.fetchSessionTitle.mockResolvedValue("");

    await deliver()({
      kind: "assistant_response",
      sessionId: "session-1",
      sessionDirectory: "/alpha/other",
    });

    expect(sentText()).toBe(
      t("background.assistant_response", {
        project: "other",
        session: t("pinned.default_session_title"),
      }),
    );
    expect(sentText()).not.toContain("session-1");
  });

  it("falls back to the selected project when the notice carries no directory", async () => {
    mocked.getCurrentProject.mockReturnValue({ id: "p", worktree: "/work/project-b", name: "project-b" });

    await deliver()({
      kind: "assistant_response",
      sessionId: "session-1",
      sessionTitle: "Other",
    });

    expect(mocked.fetchSessionTitle).toHaveBeenCalledWith({
      id: "session-1",
      title: "Other",
      directory: "/work/project-b",
    });
    expect(sentText()).toBe(
      t("background.assistant_response", { project: "project-b", session: "Other" }),
    );
  });

  it("keeps question and permission notices on their old label without looking the session up", async () => {
    await deliver()(notice("question_asked"));
    await deliver()(notice("permission_asked"));

    expect(sentText(0)).toBe(t("background.question_asked", { session: "Other" }));
    expect(sentText(1)).toBe(t("background.permission_asked", { session: "Other" }));
    expect(mocked.fetchSessionTitle).not.toHaveBeenCalled();
    expect(mocked.loadRecentSessionDirectories).not.toHaveBeenCalled();
  });
});
