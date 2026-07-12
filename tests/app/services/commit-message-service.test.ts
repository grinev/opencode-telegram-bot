import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  sessionCreateMock: vi.fn(),
  sessionPromptMock: vi.fn(),
  sessionDeleteMock: vi.fn(),
  registerIgnoreMock: vi.fn(),
  getDiffStatMock: vi.fn(),
  getFullPatchMock: vi.fn(),
  getChangedFilesMock: vi.fn(),
  getStoredModelMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.sessionCreateMock,
      prompt: mocked.sessionPromptMock,
      delete: mocked.sessionDeleteMock,
    },
  },
}));

vi.mock("../../../src/app/services/git-service.js", () => ({
  getDiffStat: mocked.getDiffStatMock,
  getFullPatch: mocked.getFullPatchMock,
  getChangedFiles: mocked.getChangedFilesMock,
}));

vi.mock("../../../src/app/services/model-selection-service.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/app/services/scheduled-task-session-ignore-service.js", () => ({
  registerScheduledTaskSessionIgnore: mocked.registerIgnoreMock,
}));

import { generateCommitMessage } from "../../../src/app/services/commit-message-service.js";

describe("commit-message-service", () => {
  beforeEach(() => {
    mocked.sessionCreateMock.mockReset();
    mocked.sessionPromptMock.mockReset();
    mocked.sessionDeleteMock.mockReset();
    mocked.registerIgnoreMock.mockReset();

    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "temp-session", directory: "/repo" },
      error: null,
    });
    mocked.sessionDeleteMock.mockResolvedValue({ data: true, error: null });
    mocked.registerIgnoreMock.mockResolvedValue(undefined);

    mocked.getDiffStatMock.mockResolvedValue(" src/app.ts | 2 +-");
    mocked.getFullPatchMock.mockResolvedValue("diff --git a/src/app.ts b/src/app.ts");
    mocked.getChangedFilesMock.mockResolvedValue([{ path: "src/app.ts" }, { path: "b.ts" }]);
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "anthropic",
      modelID: "claude",
      variant: "default",
    });
  });

  it("generates a message via a throwaway session and deletes it afterwards", async () => {
    mocked.sessionPromptMock.mockResolvedValue({
      data: {
        info: {},
        parts: [
          { type: "step-start" },
          { type: "text", text: "```\nfeat: improve app\n```" },
        ],
      },
      error: null,
    });

    const result = await generateCommitMessage("/repo");

    expect(result).toEqual({ message: "feat: improve app", generated: true });
    expect(mocked.registerIgnoreMock).toHaveBeenCalledWith("temp-session");
    expect(mocked.sessionPromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "temp-session",
        directory: "/repo",
        model: { providerID: "anthropic", modelID: "claude" },
      }),
    );
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "temp-session" });
  });

  it("falls back to a deterministic message when session creation fails", async () => {
    mocked.sessionCreateMock.mockResolvedValue({ data: null, error: new Error("down") });

    const result = await generateCommitMessage("/repo");

    expect(result).toEqual({ message: "chore: update 2 files", generated: false });
    expect(mocked.sessionDeleteMock).not.toHaveBeenCalled();
  });

  it("retries on a fresh session without the configured model when the model is rejected", async () => {
    mocked.sessionCreateMock
      .mockResolvedValueOnce({ data: { id: "temp-session-1", directory: "/repo" }, error: null })
      .mockResolvedValueOnce({ data: { id: "temp-session-2", directory: "/repo" }, error: null });
    mocked.sessionPromptMock
      .mockResolvedValueOnce({
        data: null,
        error: { name: "UnknownError", data: { message: "Model not found: openrouter/auto" } },
      })
      .mockResolvedValueOnce({
        data: { info: {}, parts: [{ type: "text", text: "fix: retry works" }] },
        error: null,
      });

    const result = await generateCommitMessage("/repo");

    expect(result).toEqual({ message: "fix: retry works", generated: true });
    expect(mocked.sessionPromptMock).toHaveBeenCalledTimes(2);
    expect(mocked.sessionPromptMock.mock.calls[0][0]).toHaveProperty("model");
    expect(mocked.sessionPromptMock.mock.calls[0][0].sessionID).toBe("temp-session-1");
    expect(mocked.sessionPromptMock.mock.calls[1][0]).not.toHaveProperty("model");
    // The retry must run on a NEW session — the old one remembers the broken model.
    expect(mocked.sessionPromptMock.mock.calls[1][0].sessionID).toBe("temp-session-2");
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "temp-session-1" });
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "temp-session-2" });
  });

  it("deletes the session even when the prompt fails", async () => {
    mocked.sessionPromptMock.mockResolvedValue({ data: null, error: new Error("boom") });

    const result = await generateCommitMessage("/repo");

    expect(result.generated).toBe(false);
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "temp-session" });
  });

  it("falls back when the response contains no usable text", async () => {
    mocked.sessionPromptMock.mockResolvedValue({
      data: { info: {}, parts: [{ type: "text", text: "   " }] },
      error: null,
    });

    const result = await generateCommitMessage("/repo");

    expect(result.generated).toBe(false);
    expect(mocked.sessionDeleteMock).toHaveBeenCalledWith({ sessionID: "temp-session" });
  });
});
