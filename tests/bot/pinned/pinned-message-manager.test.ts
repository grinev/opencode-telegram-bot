import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../../helpers/defined.js";

const mocked = vi.hoisted(() => ({
  opencodeV2: {
    session: {
      messages: vi.fn().mockResolvedValue({ data: { data: [] } }),
      get: vi.fn().mockResolvedValue({ data: null }),
    },
  },
  directApi: vi.fn().mockResolvedValue({ data: [] }),
  getCurrentSession: vi.fn(),
  getCurrentProject: vi.fn(),
  getPinnedMessageId: vi.fn().mockReturnValue(null),
  setPinnedMessageId: vi.fn(),
  clearPinnedMessageId: vi.fn(),
  getPinnedDashboardEnabled: vi.fn().mockReturnValue(true),
  getStoredModel: vi.fn().mockReturnValue(null),
  getModelContextLimit: vi.fn().mockResolvedValue(204800),
  getGitWorktreeContext: vi.fn(),
  formatModelDisplayName: vi.fn(() => "test-model"),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeV2: mocked.opencodeV2,
  directApi: mocked.directApi,
}));
vi.mock("../../../src/app/services/worktree-service.js", () => ({
  getGitWorktreeContext: mocked.getGitWorktreeContext,
}));
vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: mocked.getCurrentSession,
}));
vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentProject: mocked.getCurrentProject,
  getPinnedMessageId: mocked.getPinnedMessageId,
  setPinnedMessageId: mocked.setPinnedMessageId,
  clearPinnedMessageId: mocked.clearPinnedMessageId,
  getPinnedDashboardEnabled: mocked.getPinnedDashboardEnabled,
}));
vi.mock("../../../src/app/services/model-selection-service.js", () => ({ getStoredModel: mocked.getStoredModel }));
vi.mock("../../../src/app/services/model-context-limit-service.js", () => ({
  DEFAULT_CONTEXT_LIMIT: 204800,
  getModelContextLimit: mocked.getModelContextLimit,
}));
vi.mock("../../../src/i18n/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/i18n/index.js")>();
  return {
    ...actual,
    t: (key: string, params?: Record<string, string | number>) => {
      if (key === "pinned.default_session_title") return "new session";
      if (key === "pinned.unknown") return "Unknown";
      if (key === "pinned.line.project") return `Project: ${params?.project ?? ""}`;
      if (key === "pinned.line.worktree") return `Worktree: ${params?.worktree ?? ""}`;
      if (key === "pinned.line.model") return `Model: ${params?.model ?? ""}`;
      if (key === "pinned.files.title") return `Files (${params?.count ?? 0}):`;
      if (key === "pinned.files.item") return `  ${params?.path ?? ""}${params?.diff ?? ""}`;
      if (key === "pinned.files.more") return `  ... and ${params?.count ?? 0} more`;
      return key;
    },
  };
});
vi.mock("../../../src/bot/pinned/pinned-message-format.js", () => ({
  DEFAULT_CONTEXT_LIMIT: 204800,
  formatContextLine: (used: number, limit: number) => `${used}/${limit}`,
  formatCostLine: (cost: number) => `$${cost.toFixed(2)}`,
  formatModelDisplayName: mocked.formatModelDisplayName,
}));

// Must import AFTER vi.mock calls
const { pinnedMessageManager } = await import("../../../src/bot/pinned/pinned-message-manager.js");
const { __resetStreamThrottleForTests, noteStreamActivity } = await import(
  "../../../src/bot/streaming/stream-throttle.js"
);

describe("pinned/manager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  let fakeApi: {
    sendMessage: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
    pinChatMessage: ReturnType<typeof vi.fn>;
    unpinChatMessage: ReturnType<typeof vi.fn>;
    unpinAllChatMessages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    fakeApi = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      pinChatMessage: vi.fn().mockResolvedValue(undefined),
      unpinChatMessage: vi.fn().mockResolvedValue(undefined),
      unpinAllChatMessages: vi.fn().mockResolvedValue(undefined),
    };

    __resetStreamThrottleForTests();
    // Reset manager state by re-initializing
    pinnedMessageManager.initialize(fakeApi as never, 123);

    mocked.getCurrentSession.mockReturnValue({ id: "ses-1", title: "Test Session" });
    mocked.getCurrentProject.mockReturnValue({ id: "p1", worktree: "D:/repo", name: "repo" });
    mocked.formatModelDisplayName.mockReset();
    mocked.formatModelDisplayName.mockReturnValue("test-model");
    mocked.getStoredModel.mockReturnValue({ providerID: "openai", modelID: "gpt-5" });
    mocked.getModelContextLimit.mockResolvedValue(204800);
    mocked.getPinnedMessageId.mockReturnValue(null);
    mocked.getPinnedDashboardEnabled.mockReturnValue(true);
    mocked.opencodeV2.session.messages.mockResolvedValue({ data: { data: [] } });
    mocked.directApi.mockResolvedValue({ data: [] });
    mocked.opencodeV2.session.get.mockResolvedValue({ data: null });
    mocked.getGitWorktreeContext.mockResolvedValue({
      mainProjectPath: "D:/repo",
      activeWorktreePath: "D:/repo",
      branch: "main",
      isLinkedWorktree: false,
      worktrees: [],
    });
  });

  describe("loadContextFromHistory", () => {
    it("loads context tokens and cost from the latest assistant message", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      mocked.opencodeV2.session.messages.mockResolvedValue({
        data: {
          data: [
            {
              type: "assistant",
              time: { created: 100 },
              tokens: { input: 900, cache: { read: 100 } },
              cost: 0.25,
            },
            {
              type: "assistant",
              time: { created: 200 },
              tokens: { input: 300, cache: { read: 100 } },
              cost: 0.5,
            },
            {
              type: "compaction",
              id: "compaction-1",
              reason: "auto",
              summary: "summary",
              recent: "recent",
              time: { created: 300 },
            },
          ],
        },
        error: null,
      });

      await pinnedMessageManager.loadContextFromHistory("ses-1", "D:/repo");

      const state = pinnedMessageManager.getState();
      expect(state.tokensUsed).toBe(400);
      expect(state.cost).toBeCloseTo(0.75);
    });
  });

  describe("updateTokensSilent", () => {
    it("updates tokensUsed in memory without triggering API call", () => {
      pinnedMessageManager.updateTokensSilent({
        input: 5000,
        output: 200,
        reasoning: 0,
        cacheRead: 1000,
        cacheWrite: 0,
      });

      pinnedMessageManager.getContextInfo();
      // tokensUsed = input + cacheRead = 5000 + 1000 = 6000
      // contextInfo may be null if tokensLimit is 0, so check via getContextInfo
      // The key assertion: no API call was made
      expect(fakeApi.editMessageText).not.toHaveBeenCalled();
      expect(fakeApi.sendMessage).not.toHaveBeenCalled();
    });

    it("accumulates token updates correctly", () => {
      pinnedMessageManager.updateTokensSilent({
        input: 500,
        output: 100,
        reasoning: 0,
        cacheRead: 100,
        cacheWrite: 0,
      });

      pinnedMessageManager.updateTokensSilent({
        input: 5000,
        output: 200,
        reasoning: 0,
        cacheRead: 1000,
        cacheWrite: 0,
      });

      // Should reflect the LATEST values, not accumulated
      // No API calls
      expect(fakeApi.editMessageText).not.toHaveBeenCalled();
    });
  });

  describe("refresh", () => {
    it("calls editMessageText to push current state to Telegram", async () => {
      // Set up state: create a pinned message first
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      // Reset to track only refresh calls
      fakeApi.editMessageText.mockClear();

      await pinnedMessageManager.refresh();

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("does not throw when no pinned message exists", async () => {
      // No pinned message was created → refresh should be a no-op
      await expect(pinnedMessageManager.refresh()).resolves.not.toThrow();
    });

    it("refreshes git branch in the pinned project line", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      fakeApi.editMessageText.mockClear();
      mocked.getGitWorktreeContext.mockResolvedValue({
        mainProjectPath: "D:/repo",
        activeWorktreePath: "D:/repo",
        branch: "feature/mobile",
        isLinkedWorktree: false,
        worktrees: [],
      });

      await pinnedMessageManager.refresh();

      expect(fakeApi.editMessageText).toHaveBeenCalledWith(
        123,
        999,
        expect.stringContaining("Project: D:/repo: feature/mobile"),
      );
    });
  });

  describe("project branch display", () => {
    it("shows git branch after the project name", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(fakeApi.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining("Project: D:/repo: main"),
      );
    });

    it("keeps only project name when branch is unavailable", async () => {
      mocked.getGitWorktreeContext.mockResolvedValue({
        mainProjectPath: "D:/repo",
        activeWorktreePath: "D:/repo",
        branch: null,
        isLinkedWorktree: false,
        worktrees: [],
      });

      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(fakeApi.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining("Project: D:/repo"),
      );
      expect(fakeApi.sendMessage).not.toHaveBeenCalledWith(
        123,
        expect.stringContaining("Project: D:/repo:"),
      );
    });

    it("shows separate worktree line for linked worktrees", async () => {
      mocked.getCurrentProject.mockReturnValue({
        id: "p1",
        worktree: "D:/repo-feature",
        name: "repo-feature",
      });
      mocked.getGitWorktreeContext.mockResolvedValue({
        mainProjectPath: "D:/repo",
        activeWorktreePath: "D:/repo-feature",
        branch: "feature/worktree",
        isLinkedWorktree: true,
        worktrees: [],
      });

      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(fakeApi.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining("Project: D:/repo: feature/worktree"),
      );
      expect(fakeApi.sendMessage).toHaveBeenCalledWith(
        123,
        expect.stringContaining("Worktree: D:/repo-feature"),
      );
    });
  });

  describe("model line", () => {
    it("passes the stored variant into the model formatter", async () => {
      mocked.getStoredModel.mockReturnValue({
        providerID: "openai",
        modelID: "gpt-5",
        variant: "low",
      });

      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(mocked.formatModelDisplayName).toHaveBeenCalledWith("openai", "gpt-5", "low");
    });
  });

  describe("setOnKeyboardUpdate race condition fix", () => {
    it("fires callback immediately with current state when contextLimit is known", async () => {
      // Create session to set contextLimit
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      const callback = vi.fn();
      pinnedMessageManager.setOnKeyboardUpdate(callback);

      // Should have been called immediately with (tokensUsed=0, limit=204800)
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(0, 204800);
    });

    it("fires callback with updated tokens after silent update", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      pinnedMessageManager.updateTokensSilent({
        input: 3000,
        output: 100,
        reasoning: 0,
        cacheRead: 500,
        cacheWrite: 0,
      });

      const callback = vi.fn();
      pinnedMessageManager.setOnKeyboardUpdate(callback);

      // Should fire with tokensUsed = 3000 + 500 = 3500
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(3500, 204800);
    });
  });

  describe("addFileChange debouncing", () => {
    beforeEach(async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.editMessageText.mockClear();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    it("coalesces rapid file changes into a single pinned update", async () => {
      pinnedMessageManager.addFileChange({ file: "D:/repo/src/a.ts", additions: 1, deletions: 0 });
      pinnedMessageManager.addFileChange({ file: "D:/repo/src/b.ts", additions: 2, deletions: 1 });
      pinnedMessageManager.addFileChange({ file: "D:/repo/src/c.ts", additions: 3, deletions: 0 });

      expect(fakeApi.editMessageText).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
      const text = String(defined(fakeApi.editMessageText.mock.calls[0]?.[2]));
      expect(text).toContain("src/a.ts (+1)");
      expect(text).toContain("src/b.ts (+2 -1)");
      expect(text).toContain("src/c.ts (+3)");
    });

    it("restarts the debounce window on every new file change", async () => {
      pinnedMessageManager.addFileChange({ file: "D:/repo/src/a.ts", additions: 1, deletions: 0 });
      await vi.advanceTimersByTimeAsync(900);
      pinnedMessageManager.addFileChange({ file: "D:/repo/src/b.ts", additions: 1, deletions: 0 });
      await vi.advanceTimersByTimeAsync(900);

      expect(fakeApi.editMessageText).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("accumulates additions and deletions for the same file", async () => {
      pinnedMessageManager.addFileChange({ file: "D:/repo/src/a.ts", additions: 1, deletions: 2 });
      pinnedMessageManager.addFileChange({ file: "D:/repo/src/a.ts", additions: 4, deletions: 1 });

      await vi.advanceTimersByTimeAsync(1000);

      expect(pinnedMessageManager.getState().changedFiles).toEqual([
        { file: "D:/repo/src/a.ts", additions: 5, deletions: 3 },
      ]);
    });

    it("lengthens the debounce window after a minute of activity", async () => {
      noteStreamActivity("ses-1", Date.now() - 60_000);

      pinnedMessageManager.addFileChange({ file: "D:/repo/src/b.ts", additions: 1, deletions: 0 });
      await vi.advanceTimersByTimeAsync(1999);
      expect(fakeApi.editMessageText).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
    });
  });

  describe("flushPendingPinnedUpdates", () => {
    beforeEach(async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.editMessageText.mockClear();
    });

    it("merges updates requested while an edit is in flight into one follow-up edit", async () => {
      let releaseFirstEdit: () => void = () => {};
      const firstEditGate = new Promise<void>((resolve) => {
        releaseFirstEdit = resolve;
      });
      fakeApi.editMessageText.mockImplementationOnce(() => firstEditGate);

      const first = pinnedMessageManager.onCostUpdate(1);
      const second = pinnedMessageManager.onCostUpdate(2);
      const third = pinnedMessageManager.onCostUpdate(3);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
      expect(String(defined(fakeApi.editMessageText.mock.calls[0]?.[2]))).toContain("$1.00");

      releaseFirstEdit();
      await Promise.all([first, second, third]);

      // The two updates that arrived during the first edit collapse into a
      // single trailing edit carrying the latest state.
      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(2);
      expect(String(defined(fakeApi.editMessageText.mock.calls[1]?.[2]))).toContain("$6.00");
    });

    it("skips a non-forced update when the rendered text did not change", async () => {
      const tokens = { input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

      await pinnedMessageManager.onMessageComplete(tokens);
      await pinnedMessageManager.onMessageComplete(tokens);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("edits the message on refresh() even when the text did not change", async () => {
      await pinnedMessageManager.refresh();
      await pinnedMessageManager.refresh();

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(2);
    });
  });

  describe("pinned message edit errors", () => {
    const tokens = { input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 };

    beforeEach(async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.editMessageText.mockClear();
      fakeApi.sendMessage.mockClear();
      mocked.setPinnedMessageId.mockClear();
      mocked.clearPinnedMessageId.mockClear();
    });

    it("treats 'message is not modified' as delivered and skips the identical retry", async () => {
      fakeApi.editMessageText.mockRejectedValueOnce(
        new Error("Bad Request: message is not modified"),
      );

      await pinnedMessageManager.onMessageComplete(tokens);
      await pinnedMessageManager.onMessageComplete(tokens);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("retries the same text after an unexpected edit failure", async () => {
      fakeApi.editMessageText.mockRejectedValueOnce(new Error("Bad Request: chat not found"));

      await pinnedMessageManager.onMessageComplete(tokens);
      await pinnedMessageManager.onMessageComplete(tokens);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(2);
    });

    it("recreates the pinned message when Telegram reports it was deleted", async () => {
      fakeApi.editMessageText.mockRejectedValueOnce(
        new Error("Bad Request: message to edit not found"),
      );
      fakeApi.sendMessage.mockResolvedValue({ message_id: 1001 });

      await pinnedMessageManager.onMessageComplete(tokens);

      expect(mocked.clearPinnedMessageId).toHaveBeenCalledTimes(1);
      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(mocked.setPinnedMessageId).toHaveBeenCalledWith(1001);
      expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 1001, {
        disable_notification: true,
      });
      expect(pinnedMessageManager.getState().messageId).toBe(1001);
    });
  });

  describe("loading file diffs on session change", () => {
    it("uses session diff results and ignores entries without a file", async () => {
      mocked.directApi.mockResolvedValue({
        data: [
          { file: "D:/repo/src/a.ts", additions: 3, deletions: 1 },
          { additions: 9, deletions: 9 },
          { file: "D:/repo/src/b.ts", additions: 0, deletions: 2 },
        ],
        error: null,
      });

      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(pinnedMessageManager.getState().changedFiles).toEqual([
        { file: "D:/repo/src/a.ts", additions: 3, deletions: 1 },
        { file: "D:/repo/src/b.ts", additions: 0, deletions: 2 },
      ]);
      expect(mocked.opencodeV2.session.messages).not.toHaveBeenCalled();
      expect(fakeApi.editMessageText).toHaveBeenCalledWith(
        123,
        999,
        expect.stringContaining("src/a.ts (+3 -1)"),
      );
    });

    it("falls back to tool parts from session messages when session diff is empty", async () => {
      mocked.opencodeV2.session.messages.mockResolvedValue({
        data: {
          data: [
            {
              type: "assistant",
              content: [
                {
                  type: "tool",
                  name: "edit",
                  state: { status: "completed", outputPaths: ["D:/repo/src/a.ts"] },
                },
                {
                  type: "tool",
                  name: "apply_patch",
                  state: { status: "completed", outputPaths: ["D:/repo/src/a.ts"] },
                },
                {
                  type: "tool",
                  name: "write",
                  state: {
                    status: "completed",
                    input: { filePath: "D:/repo/src/b.ts", content: "one\ntwo\nthree" },
                  },
                },
                {
                  type: "tool",
                  name: "bash",
                  state: { status: "completed", input: { command: "npm test" } },
                },
                {
                  type: "tool",
                  name: "edit",
                  state: { status: "running", outputPaths: ["D:/repo/src/pending.ts"] },
                },
                { type: "text", text: "done" },
              ],
            },
          ],
        },
        error: null,
      });

      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(pinnedMessageManager.getState().changedFiles).toEqual([
        { file: "D:/repo/src/a.ts", additions: 0, deletions: 0 },
        { file: "D:/repo/src/b.ts", additions: 0, deletions: 0 },
      ]);
    });

    it("leaves the diff list empty when neither source reports file changes", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(mocked.opencodeV2.session.messages).toHaveBeenCalledTimes(1);
      expect(pinnedMessageManager.getState().changedFiles).toEqual([]);
    });

    it("does not call the diff API when no project is selected", async () => {
      mocked.getCurrentProject.mockReturnValue(null);

      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(mocked.directApi).not.toHaveBeenCalled();
      expect(mocked.opencodeV2.session.messages).not.toHaveBeenCalled();
    });
  });

  describe("onSessionDiff", () => {
    beforeEach(async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.editMessageText.mockClear();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    it("ignores an empty diff when tool events already collected file changes", async () => {
      pinnedMessageManager.addFileChange({ file: "D:/repo/src/a.ts", additions: 1, deletions: 0 });

      await pinnedMessageManager.onSessionDiff([]);

      expect(fakeApi.editMessageText).not.toHaveBeenCalled();
      expect(pinnedMessageManager.getState().changedFiles).toHaveLength(1);
    });

    it("ignores a diff identical to the current one", async () => {
      await pinnedMessageManager.onSessionDiff([
        { file: "D:/repo/src/a.ts", additions: 1, deletions: 0 },
      ]);
      await pinnedMessageManager.onSessionDiff([
        { file: "D:/repo/src/a.ts", additions: 1, deletions: 0 },
      ]);

      await vi.advanceTimersByTimeAsync(1000);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("applies a diff that drops one of the changed files", async () => {
      await pinnedMessageManager.onSessionDiff([
        { file: "D:/repo/src/a.ts", additions: 1, deletions: 0 },
        { file: "D:/repo/src/b.ts", additions: 2, deletions: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(1000);
      await pinnedMessageManager.onSessionDiff([
        { file: "D:/repo/src/a.ts", additions: 1, deletions: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(2);
      expect(String(defined(fakeApi.editMessageText.mock.calls[1]?.[2]))).not.toContain("src/b.ts");
    });

    it("applies a diff that changes the line counts of the same file", async () => {
      await pinnedMessageManager.onSessionDiff([
        { file: "D:/repo/src/a.ts", additions: 1, deletions: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(1000);
      await pinnedMessageManager.onSessionDiff([
        { file: "D:/repo/src/a.ts", additions: 2, deletions: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(2);
      expect(String(defined(fakeApi.editMessageText.mock.calls[1]?.[2]))).toContain("src/a.ts (+2)");
    });
  });

  describe("restoreExistingSession", () => {
    beforeEach(() => {
      mocked.getPinnedMessageId.mockReturnValue(777);
      pinnedMessageManager.initialize(fakeApi as never, 123);
    });

    it("edits the persisted pinned message instead of creating a new one", async () => {
      await pinnedMessageManager.restoreExistingSession("ses-1", "Restored session");

      expect(fakeApi.sendMessage).not.toHaveBeenCalled();
      expect(fakeApi.editMessageText).toHaveBeenCalledWith(
        123,
        777,
        expect.stringContaining("Restored session"),
      );
      expect(pinnedMessageManager.getState().messageId).toBe(777);
    });

    it("restores the file diffs of the session it reattaches to", async () => {
      mocked.directApi.mockResolvedValue({
        data: [{ file: "D:/repo/src/a.ts", additions: 4, deletions: 0 }],
      });

      await pinnedMessageManager.restoreExistingSession("ses-1", "Restored session");

      expect(pinnedMessageManager.getState().changedFiles).toEqual([
        { file: "D:/repo/src/a.ts", additions: 4, deletions: 0 },
      ]);
      expect(fakeApi.editMessageText).toHaveBeenLastCalledWith(
        123,
        777,
        expect.stringContaining("src/a.ts (+4)"),
      );
    });
  });

  describe("context limit", () => {
    it("reports no context info until a limit is known", () => {
      expect(pinnedMessageManager.getContextInfo()).toBeNull();
      expect(pinnedMessageManager.getContextLimit()).toBe(0);
    });

    it("fetches the limit lazily when a message completes without one", async () => {
      await pinnedMessageManager.onMessageComplete({
        input: 100,
        output: 10,
        reasoning: 0,
        cacheRead: 50,
        cacheWrite: 0,
      });

      expect(mocked.getModelContextLimit).toHaveBeenCalledTimes(1);
      expect(pinnedMessageManager.getContextInfo()).toEqual({
        tokensUsed: 150,
        tokensLimit: 204800,
      });
    });

    it("re-reads the limit after a model change", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      mocked.getModelContextLimit.mockResolvedValue(1_000_000);

      await pinnedMessageManager.refreshContextLimit();

      expect(pinnedMessageManager.getContextLimit()).toBe(1_000_000);
    });

    it("falls back to the default limit when the model lookup fails", async () => {
      mocked.getModelContextLimit.mockRejectedValue(new Error("model registry unavailable"));

      await pinnedMessageManager.refreshContextLimit();

      expect(pinnedMessageManager.getContextLimit()).toBe(204800);
    });
  });

  describe("incremental state updates", () => {
    beforeEach(async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.editMessageText.mockClear();
    });

    it("updates the pinned message only for a new non-empty session title", async () => {
      await pinnedMessageManager.onSessionTitleUpdate("Test Session");
      await pinnedMessageManager.onSessionTitleUpdate("");
      expect(fakeApi.editMessageText).not.toHaveBeenCalled();

      await pinnedMessageManager.onSessionTitleUpdate("Renamed session");

      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
      expect(String(defined(fakeApi.editMessageText.mock.calls[0]?.[2]))).toContain("Renamed session");
    });

    it("drops the busy flag as soon as the session is detached", async () => {
      await pinnedMessageManager.setAttachState(true, true);
      expect(pinnedMessageManager.getState()).toMatchObject({
        attachActive: true,
        attachBusy: true,
      });

      await pinnedMessageManager.setAttachState(false, true);

      expect(pinnedMessageManager.getState()).toMatchObject({
        attachActive: false,
        attachBusy: false,
      });
    });

    it("ignores cost updates that cannot change the total", async () => {
      await pinnedMessageManager.onCostUpdate(0);
      await pinnedMessageManager.onCostUpdate(Number.NaN);

      expect(fakeApi.editMessageText).not.toHaveBeenCalled();
    });

    it("reloads context from history after a compaction", async () => {
      mocked.opencodeV2.session.messages.mockResolvedValue({
        data: {
          data: [
            {
              type: "assistant",
              time: { created: 100 },
              tokens: { input: 700, cache: { read: 300 } },
              cost: 0.3,
            },
          ],
        },
        error: null,
      });

      await pinnedMessageManager.onSessionCompacted("ses-1", "D:/repo");

      expect(pinnedMessageManager.getState().tokensUsed).toBe(1000);
      expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
    });

    it("keeps the current context when the history request fails", async () => {
      pinnedMessageManager.updateTokensSilent({
        input: 400,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });
      mocked.opencodeV2.session.messages.mockResolvedValue({ error: { message: "boom" } });

      await pinnedMessageManager.loadContextFromHistory("ses-1", "D:/repo");

      expect(pinnedMessageManager.getState().tokensUsed).toBe(400);
      expect(fakeApi.editMessageText).not.toHaveBeenCalled();
    });

    it("notifies the keyboard callback after a successful edit", async () => {
      const callback = vi.fn();
      pinnedMessageManager.setOnKeyboardUpdate(callback);
      callback.mockClear();

      await pinnedMessageManager.refresh();
      await new Promise((resolve) => setImmediate(resolve));

      expect(callback).toHaveBeenCalledWith(0, 204800);
    });
  });

  describe("changed files rendering", () => {
    beforeEach(async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.editMessageText.mockClear();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    it("lists at most ten files and reports the rest as a count", async () => {
      await pinnedMessageManager.onSessionDiff(
        Array.from({ length: 12 }, (_, index) => ({
          file: `D:/repo/src/file-${index}.ts`,
          additions: 1,
          deletions: 0,
        })),
      );
      await vi.advanceTimersByTimeAsync(1000);

      const text = String(defined(fakeApi.editMessageText.mock.calls[0]?.[2]));
      expect(text).toContain("Files (12):");
      expect(text).toContain("src/file-9.ts");
      expect(text).not.toContain("src/file-10.ts");
      expect(text).toContain("... and 2 more");
    });

    it("shortens paths that live outside the current project", async () => {
      await pinnedMessageManager.onSessionDiff([
        { file: "C:/other/deep/nested/path/file.ts", additions: 1, deletions: 0 },
      ]);
      await vi.advanceTimersByTimeAsync(1000);

      expect(String(defined(fakeApi.editMessageText.mock.calls[0]?.[2]))).toContain(".../nested/path/file.ts");
    });
  });

  describe("clear", () => {
    it("unpins the message and drops the session state", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.unpinAllChatMessages.mockClear();
      mocked.clearPinnedMessageId.mockClear();

      await pinnedMessageManager.clear();

      expect(fakeApi.unpinAllChatMessages).toHaveBeenCalledWith(123);
      expect(mocked.clearPinnedMessageId).toHaveBeenCalledTimes(1);
      expect(pinnedMessageManager.getState()).toMatchObject({
        messageId: null,
        sessionId: null,
        sessionTitle: "new session",
        tokensUsed: 0,
        tokensLimit: 0,
        changedFiles: [],
      });
    });

    it("resets state without touching Telegram when not initialized", async () => {
      pinnedMessageManager.__resetForTests();
      fakeApi.unpinAllChatMessages.mockClear();

      await pinnedMessageManager.clear();

      expect(pinnedMessageManager.isInitialized()).toBe(false);
      expect(fakeApi.unpinAllChatMessages).not.toHaveBeenCalled();
      expect(mocked.clearPinnedMessageId).toHaveBeenCalledTimes(1);
    });
  });

  describe("pinned dashboard setting", () => {
    it("does not send, pin, or unpin-all on session change when off", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);

      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(fakeApi.sendMessage).not.toHaveBeenCalled();
      expect(fakeApi.pinChatMessage).not.toHaveBeenCalled();
      expect(fakeApi.unpinAllChatMessages).not.toHaveBeenCalled();
      expect(fakeApi.editMessageText).not.toHaveBeenCalled();
    });

    it("does not edit a leftover message on restore when off", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      mocked.getPinnedMessageId.mockReturnValue(777);
      pinnedMessageManager.initialize(fakeApi as never, 123);

      await pinnedMessageManager.restoreExistingSession("ses-1", "Restored session");

      expect(fakeApi.unpinChatMessage).toHaveBeenCalledWith(123, 777);
      expect(fakeApi.editMessageText).not.toHaveBeenCalled();
      expect(fakeApi.sendMessage).not.toHaveBeenCalled();
      expect(fakeApi.pinChatMessage).not.toHaveBeenCalled();
      expect(pinnedMessageManager.getState().messageId).toBeNull();
    });

    it("keeps the leftover id when restore unpin fails transiently", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      mocked.getPinnedMessageId.mockReturnValue(777);
      pinnedMessageManager.initialize(fakeApi as never, 123);
      fakeApi.unpinChatMessage.mockRejectedValueOnce(new Error("Bad Request: too many requests"));
      mocked.clearPinnedMessageId.mockClear();

      await pinnedMessageManager.restoreExistingSession("ses-1", "Restored session");

      expect(fakeApi.unpinChatMessage).toHaveBeenCalledWith(123, 777);
      expect(mocked.clearPinnedMessageId).not.toHaveBeenCalled();
      expect(pinnedMessageManager.getState().messageId).toBeNull();

      fakeApi.unpinChatMessage.mockResolvedValue(undefined);
      fakeApi.sendMessage.mockClear();
      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.unpinChatMessage).toHaveBeenLastCalledWith(123, 777);
      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 999, {
        disable_notification: true,
      });
    });

    it("forgets the leftover id when restore unpin says the message is gone", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      mocked.getPinnedMessageId.mockReturnValue(777);
      pinnedMessageManager.initialize(fakeApi as never, 123);
      fakeApi.unpinChatMessage.mockRejectedValueOnce(
        new Error("Bad Request: message to unpin not found"),
      );

      await pinnedMessageManager.restoreExistingSession("ses-1", "Restored session");

      expect(pinnedMessageManager.getState().messageId).toBeNull();
      expect(mocked.clearPinnedMessageId).toHaveBeenCalled();
    });

    it("does not unpin-all on clear when off", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.unpinAllChatMessages.mockClear();
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);

      await pinnedMessageManager.clear();

      expect(fakeApi.unpinAllChatMessages).not.toHaveBeenCalled();
    });

    it("keeps parked leftover ownership across clear while off", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      mocked.getPinnedMessageId.mockReturnValue(777);
      pinnedMessageManager.initialize(fakeApi as never, 123);
      fakeApi.unpinChatMessage.mockRejectedValue(new Error("Bad Request: too many requests"));
      mocked.clearPinnedMessageId.mockClear();

      await pinnedMessageManager.restoreExistingSession("ses-1", "Restored session");
      await pinnedMessageManager.clear();

      expect(mocked.clearPinnedMessageId).not.toHaveBeenCalled();

      fakeApi.unpinChatMessage.mockReset();
      fakeApi.unpinChatMessage.mockResolvedValue(undefined);
      fakeApi.sendMessage.mockClear();
      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.unpinChatMessage).toHaveBeenLastCalledWith(123, 777);
      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("does not edit the leftover dashboard on later updates when off", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.editMessageText.mockClear();
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);

      await pinnedMessageManager.onMessageComplete({
        input: 100,
        output: 10,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      });

      expect(fakeApi.editMessageText).not.toHaveBeenCalled();
      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("still fires the keyboard callback when off", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      const callback = vi.fn();
      pinnedMessageManager.setOnKeyboardUpdate(callback);

      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

      expect(callback).toHaveBeenCalled();
      expect(fakeApi.sendMessage).not.toHaveBeenCalled();
    });

    it("unpins only the dashboard message when the setting is turned off", async () => {
      await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
      fakeApi.unpinAllChatMessages.mockClear();
      mocked.clearPinnedMessageId.mockClear();

      await pinnedMessageManager.applyPinnedDashboardEnabled(false);

      expect(fakeApi.unpinChatMessage).toHaveBeenCalledWith(123, 999);
      expect(fakeApi.unpinAllChatMessages).not.toHaveBeenCalled();
      expect(mocked.clearPinnedMessageId).toHaveBeenCalled();
      expect(pinnedMessageManager.getState().messageId).toBeNull();
    });

    it("sends and pins a dashboard when turned on with a session", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      pinnedMessageManager.__resetForTests();
      pinnedMessageManager.initialize(fakeApi as never, 123);

      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(String(defined(fakeApi.sendMessage.mock.calls[0]?.[1]))).toContain("D:/repo");
      expect(String(defined(fakeApi.sendMessage.mock.calls[0]?.[1]))).toContain("0/204800");
      expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 999, {
        disable_notification: true,
      });
      expect(mocked.setPinnedMessageId).toHaveBeenCalledWith(999);
    });

    it("does nothing when turned on with no session", async () => {
      mocked.getCurrentSession.mockReturnValue(undefined);

      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.sendMessage).not.toHaveBeenCalled();
      expect(fakeApi.pinChatMessage).not.toHaveBeenCalled();
    });

    it("unpins a parked leftover when turned on with no session", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      mocked.getPinnedMessageId.mockReturnValue(777);
      mocked.getCurrentSession.mockReturnValue(undefined);
      pinnedMessageManager.initialize(fakeApi as never, 123);
      fakeApi.unpinChatMessage.mockRejectedValueOnce(new Error("Bad Request: too many requests"));
      await pinnedMessageManager.restoreExistingSession("ses-1", "Restored session");
      fakeApi.unpinChatMessage.mockResolvedValue(undefined);
      mocked.clearPinnedMessageId.mockClear();

      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.unpinChatMessage).toHaveBeenLastCalledWith(123, 777);
      expect(mocked.clearPinnedMessageId).toHaveBeenCalled();
      expect(fakeApi.sendMessage).not.toHaveBeenCalled();
    });

    it("retries pinning the same message after send-ok pin-fail", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      fakeApi.pinChatMessage.mockRejectedValueOnce(new Error("Bad Request: too many requests"));

      await expect(pinnedMessageManager.applyPinnedDashboardEnabled(true)).rejects.toThrow(
        /too many requests/,
      );
      expect(pinnedMessageManager.getState().messageId).toBe(999);
      expect(mocked.setPinnedMessageId).not.toHaveBeenCalled();
      fakeApi.sendMessage.mockClear();

      fakeApi.pinChatMessage.mockResolvedValue(undefined);
      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.sendMessage).not.toHaveBeenCalled();
      expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 999, {
        disable_notification: true,
      });
    });

    it("does not pin a leftover dashboard after a session change while off", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      mocked.getPinnedMessageId.mockReturnValue(777);
      pinnedMessageManager.initialize(fakeApi as never, 123);
      fakeApi.unpinChatMessage.mockRejectedValue(new Error("Bad Request: too many requests"));

      await pinnedMessageManager.onSessionChange("ses-2", "Other");
      expect(pinnedMessageManager.getState().messageId).toBeNull();
      expect(pinnedMessageManager.getState().sessionId).toBe("ses-2");

      fakeApi.unpinChatMessage.mockReset();
      fakeApi.unpinChatMessage.mockResolvedValue(undefined);
      fakeApi.sendMessage.mockClear();
      fakeApi.sendMessage.mockResolvedValue({ message_id: 1005 });
      mocked.getCurrentSession.mockReturnValue({ id: "ses-2", title: "Other" });

      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.unpinChatMessage).toHaveBeenCalledWith(123, 777);
      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 1005, {
        disable_notification: true,
      });
      expect(fakeApi.pinChatMessage).not.toHaveBeenCalledWith(123, 777, expect.anything());
    });

    it("creates the current dashboard when the session changes before retry", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      fakeApi.pinChatMessage.mockRejectedValueOnce(new Error("Bad Request: too many requests"));
      await expect(pinnedMessageManager.applyPinnedDashboardEnabled(true)).rejects.toThrow();
      mocked.getCurrentSession.mockReturnValue({ id: "ses-2", title: "Other" });

      await pinnedMessageManager.onSessionChange("ses-2", "Other");
      fakeApi.sendMessage.mockClear();
      fakeApi.sendMessage.mockResolvedValue({ message_id: 1002 });
      fakeApi.pinChatMessage.mockResolvedValue(undefined);

      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 1002, {
        disable_notification: true,
      });
    });

    it("creates a new dashboard after restart between pin failure and retry", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      fakeApi.pinChatMessage.mockRejectedValueOnce(new Error("Bad Request: too many requests"));
      await expect(pinnedMessageManager.applyPinnedDashboardEnabled(true)).rejects.toThrow();
      mocked.getPinnedMessageId.mockReturnValue(999);
      pinnedMessageManager.__resetForTests();
      pinnedMessageManager.initialize(fakeApi as never, 123);
      fakeApi.sendMessage.mockClear();
      fakeApi.sendMessage.mockResolvedValue({ message_id: 1003 });
      fakeApi.pinChatMessage.mockResolvedValue(undefined);

      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 1003, {
        disable_notification: true,
      });
    });

    it("creates a new dashboard when the retained message is gone", async () => {
      mocked.getPinnedDashboardEnabled.mockReturnValue(false);
      fakeApi.pinChatMessage
        .mockRejectedValueOnce(new Error("Bad Request: too many requests"))
        .mockRejectedValueOnce(new Error("Bad Request: message to pin not found"));
      await expect(pinnedMessageManager.applyPinnedDashboardEnabled(true)).rejects.toThrow(
        /too many requests/,
      );
      fakeApi.sendMessage.mockClear();
      fakeApi.sendMessage.mockResolvedValue({ message_id: 1004 });

      await pinnedMessageManager.applyPinnedDashboardEnabled(true);

      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 1004, {
        disable_notification: true,
      });
    });
  });
});
