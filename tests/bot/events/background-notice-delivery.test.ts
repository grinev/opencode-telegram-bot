import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundSessionNotification } from "../../../src/app/managers/background-session-manager.js";
import { createBackgroundNoticeDelivery } from "../../../src/bot/events/background-notice-delivery.js";
import { config } from "../../../src/config.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getShowBackgroundSessionNotifications: vi.fn(),
  getCurrentProject: vi.fn(),
  fetchSessionTitle: vi.fn(),
  loadRecentSessionDirectories: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: { session: { get: mocked.getSession } },
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
    config.bot.excludedProjectPaths = [];
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
    mocked.getSession.mockReset();
  });

  function deliver(isForegroundSession = () => false) {
    return createBackgroundNoticeDelivery(
      { getDestination: () => destination as never, isForegroundSession },
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

  it("names a detached compaction and offers its session without an ordinary reply notice", async () => {
    mocked.getCurrentProject.mockReturnValue({ worktree: "/alpha/other" });
    await deliver()({
      ...notice("context_compacted"),
      sessionDirectory: undefined,
      directoryHint: "/alpha/other",
    });
    expect(mocked.getSession).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      destination,
      t("context.background_success", { project: "other", session: "Other" }),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: [[{
            text: t("background.open_session_button"), callback_data: "background-session:c:session-1",
          }]],
        }),
      }),
    );
  });

  it("suppresses compaction notices outside the selected project or after reattachment", async () => {
    mocked.getCurrentProject.mockReturnValue({ worktree: "/different" });
    await deliver()(notice("context_compacted"));
    mocked.getCurrentProject.mockReturnValue({ worktree: "/alpha/other" });
    const isForeground = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    await deliver(isForeground)(notice("context_compacted"));
    mocked.getShowBackgroundSessionNotifications.mockReturnValue(false);
    await deliver()(notice("context_compacted"));
    expect(sendText).not.toHaveBeenCalled();
  });

  it.each([...kinds, "context_compacted"] as const)(
    "suppresses %s for an excluded session even in the selected project",
    async (kind) => {
      config.bot.excludedProjectPaths = ["/alpha/other/"];
      mocked.getCurrentProject.mockReturnValue({ worktree: "/alpha/other" });
      const notification = notice(kind);
      if (kind === "context_compacted") {
        notification.sessionDirectory = undefined;
        notification.directoryHint = "/alpha/other";
        mocked.getSession.mockResolvedValue({ data: { directory: "/alpha/other", title: "Other" } });
      }

      await deliver()(notification);

      expect(sendText).not.toHaveBeenCalled();
      expect(mocked.fetchSessionTitle).not.toHaveBeenCalled();
      expect(mocked.loadRecentSessionDirectories).not.toHaveBeenCalled();
      expect(mocked.getSession).toHaveBeenCalledTimes(kind === "context_compacted" ? 1 : 0);
    },
  );

  it("uses the session lookup, not an excluded selected project, to decide an absent directory", async () => {
    config.bot.excludedProjectPaths = ["/excluded"];
    mocked.getCurrentProject.mockReturnValue({ worktree: "/excluded" });
    mocked.getSession.mockResolvedValue({ data: { directory: "/alpha/other", title: "Confirmed" } });

    await deliver()({
      ...notice("assistant_response"),
      sessionDirectory: undefined,
      directoryHint: "/excluded",
    });

    expect(mocked.getSession).toHaveBeenCalledExactlyOnceWith({
      sessionID: "session-1", directory: "/excluded",
    });
    expect(mocked.fetchSessionTitle).not.toHaveBeenCalled();
    expect(sentText()).toBe(
      t("background.assistant_response", { project: "other", session: "Confirmed" }),
    );
  });

  it("suppresses a request whose confirmed directory is excluded despite a visible route", async () => {
    config.bot.excludedProjectPaths = ["/excluded"];
    mocked.getCurrentProject.mockReturnValue({ worktree: "/alpha/other" });
    mocked.getSession.mockResolvedValue({ data: { directory: "/excluded", title: "Confirmed" } });

    await deliver()({
      ...notice("permission_asked"),
      sessionDirectory: undefined,
      directoryHint: "/alpha/other",
    });

    expect(mocked.getSession).toHaveBeenCalledExactlyOnceWith({
      sessionID: "session-1", directory: "/alpha/other",
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("suppresses a notice when the lookup errors, throws or returns a blank directory", async () => {
    config.bot.excludedProjectPaths = ["/excluded"];
    mocked.getCurrentProject.mockReturnValue({ worktree: "/alpha/other" });
    mocked.getSession
      .mockResolvedValueOnce({ error: new Error("offline") })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { directory: " ", title: "Other" } });
    const send = deliver();
    const notification = { ...notice("question_asked"), sessionDirectory: undefined };

    await send(notification);
    await send(notification);
    await send(notification);

    expect(mocked.getSession).toHaveBeenCalledTimes(3);
    expect(sendText).not.toHaveBeenCalled();
  });

  it("uses the confirmed worktree rather than the captured hint for compaction scope", async () => {
    config.bot.excludedProjectPaths = ["/excluded"];
    mocked.getCurrentProject.mockReturnValue({ worktree: "/alpha/other" });
    mocked.getSession.mockResolvedValue({ data: { directory: "/alpha/other", title: "Other" } });
    const notification = { ...notice("context_compacted"), sessionDirectory: undefined };
    const send = deliver();

    await send({ ...notification, directoryHint: "/old" });
    mocked.getSession.mockResolvedValue({ data: { directory: "/different", title: "Other" } });
    await send({ ...notification, directoryHint: "/alpha/other" });

    expect(sendText).toHaveBeenCalledOnce();
    expect(sentText()).toBe(t("context.background_success", { project: "other", session: "Other" }));
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

  it.each(["assistant_response", "context_compacted"] as const)(
    "uses the folder name for %s when the recent list cannot be read",
    async (kind) => {
      config.bot.excludedProjectPaths = ["/excluded"];
      mocked.getCurrentProject.mockReturnValue({ worktree: "/alpha/other" });
      mocked.loadRecentSessionDirectories.mockRejectedValue(new Error("offline"));

      await deliver()(notice(kind));

      expect(sentText()).toBe(t(
        kind === "assistant_response" ? "background.assistant_response" : "context.background_success",
        { project: "other", session: "Other" },
      ));
    },
  );

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
    expect(mocked.getSession).not.toHaveBeenCalled();
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
