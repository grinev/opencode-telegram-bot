import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { summaryAggregator } from "../../src/summary/aggregator.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
}));

vi.mock("../../src/settings/manager.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/settings/manager.js")>(
    "../../src/settings/manager.js",
  );

  return {
    ...actual,
    getCurrentProject: mocked.getCurrentProjectMock,
  };
});

describe("summary/aggregator", () => {
  beforeEach(() => {
    mocked.getCurrentProjectMock.mockReset();
    mocked.getCurrentProjectMock.mockReturnValue({ id: "p1", worktree: "D:/repo", name: "repo" });
    summaryAggregator.clear();
    summaryAggregator.setOnCleared(() => {});
    summaryAggregator.setOnTool(() => {});
    summaryAggregator.setOnToolFile(() => {});
    summaryAggregator.setOnPartial(() => {});
    summaryAggregator.setOnThinking(() => {});
    summaryAggregator.setOnSessionError(() => {});
    summaryAggregator.setOnSessionRetry(() => {});
  });

  it("invokes onCleared callback when aggregator is cleared", () => {
    const onCleared = vi.fn();
    summaryAggregator.setOnCleared(onCleared);

    summaryAggregator.clear();

    expect(onCleared).toHaveBeenCalledTimes(1);
  });

  it("includes sessionId in tool callback payload", () => {
    const onTool = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            input: {
              command: "npm test",
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onTool).toHaveBeenCalledTimes(1);
    expect(onTool.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        callId: "call-1",
        tool: "bash",
        hasFileAttachment: false,
      }),
    );
  });

  it("marks write tool without file attachment when payload is oversized", () => {
    const onTool = vi.fn();
    const onToolFile = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-oversized",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-oversized",
          sessionID: "session-1",
          messageID: "message-oversized",
          type: "tool",
          callID: "call-oversized",
          tool: "write",
          state: {
            status: "completed",
            input: {
              filePath: "src/huge.ts",
              content: "x".repeat(101 * 1024),
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onTool).toHaveBeenCalledTimes(1);
    expect(onTool.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        tool: "write",
        hasFileAttachment: false,
      }),
    );
    expect(onToolFile).not.toHaveBeenCalled();
  });

  it("passes sessionId to thinking callback when reasoning part arrives", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-reasoning-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "reasoning",
          text: "Let me think about this...",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledWith("session-1");
  });

  it("streams partial text and passes messageId on completion", () => {
    const onPartial = vi.fn();
    const onComplete = vi.fn();

    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-stream-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-stream-1",
          sessionID: "session-1",
          messageID: "message-stream-1",
          type: "text",
          text: "Partial answer",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-stream-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledWith("session-1", "message-stream-1", "Partial answer");
    expect(onComplete).toHaveBeenCalledWith("session-1", "message-stream-1", "Partial answer");
  });

  it("combines multiple text parts into a single final message", () => {
    const onPartial = vi.fn();
    const onComplete = vi.fn();

    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-multipart-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-a",
          sessionID: "session-1",
          messageID: "message-multipart-1",
          type: "text",
          text: "Hello ",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-b",
          sessionID: "session-1",
          messageID: "message-multipart-1",
          type: "text",
          text: "world",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-multipart-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenLastCalledWith("session-1", "message-multipart-1", "Hello world");
    expect(onComplete).toHaveBeenCalledWith("session-1", "message-multipart-1", "Hello world");
  });

  it("starts optimistic partial streaming after second unknown text update", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-unknown-1",
          sessionID: "session-1",
          messageID: "message-unknown-1",
          type: "text",
          text: "H",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-unknown-2",
          sessionID: "session-1",
          messageID: "message-unknown-1",
          type: "text",
          text: "Hello",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledTimes(1);
    expect(onPartial).toHaveBeenCalledWith("session-1", "message-unknown-1", "Hello");
  });

  it("does not stream unknown text when only one update arrived", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-unknown-single",
          sessionID: "session-1",
          messageID: "message-unknown-single",
          type: "text",
          text: "Single update",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).not.toHaveBeenCalled();
  });

  it("does not emit partial when pending text is attached on completed message", () => {
    const onPartial = vi.fn();
    const onComplete = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-pending-complete",
          sessionID: "session-1",
          messageID: "message-pending-complete",
          type: "text",
          text: "Final text",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-pending-complete",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith("session-1", "message-pending-complete", "Final text");
  });

  it("streams text from message.part.delta events", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "part-delta-1",
          sessionID: "session-1",
          messageID: "message-delta-1",
          type: "text",
        },
        delta: "Hel",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "part-delta-1",
          sessionID: "session-1",
          messageID: "message-delta-1",
          type: "text",
        },
        delta: "lo",
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenNthCalledWith(1, "session-1", "message-delta-1", "Hel");
    expect(onPartial).toHaveBeenNthCalledWith(2, "session-1", "message-delta-1", "Hello");
  });

  it("streams delta events even when part type is omitted", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "part-delta-unknown-type",
          sessionID: "session-1",
          messageID: "message-delta-unknown-type",
        },
        delta: "Hi",
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledWith("session-1", "message-delta-unknown-type", "Hi");
  });

  it("does not stream unknown delta part after reasoning started", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-1",
          type: "reasoning",
          text: "thinking",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "unknown-part-after-reasoning",
          sessionID: "session-1",
          messageID: "message-reasoning-1",
        },
        delta: "internal thoughts",
      },
    } as unknown as Event);

    expect(onPartial).not.toHaveBeenCalled();
  });

  it("does not send thinking callback when no reasoning part arrives", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    // Only a message.updated event without any reasoning part — should NOT trigger thinking
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-no-reasoning",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-text-1",
          sessionID: "session-1",
          messageID: "message-no-reasoning",
          type: "text",
          text: "Here is my answer.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).not.toHaveBeenCalled();
  });

  it("fires thinking callback only once per message even with multiple reasoning parts", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-multi-reasoning",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    for (let i = 0; i < 3; i++) {
      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: `part-reasoning-${i}`,
            sessionID: "session-1",
            messageID: "message-multi-reasoning",
            type: "reasoning",
            text: `Thinking step ${i}`,
            time: { start: Date.now() },
          },
        },
      } as unknown as Event);
    }

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledTimes(1);
    expect(onThinking).toHaveBeenCalledWith("session-1");
  });

  it("reports session.error message through callback", async () => {
    const onSessionError = vi.fn();
    summaryAggregator.setOnSessionError(onSessionError);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          name: "UnknownError",
          data: {
            message: "Model not found: opencode/foo.",
          },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionError).toHaveBeenCalledWith("session-1", "Model not found: opencode/foo.");
  });

  it("reports session.status retry through callback", async () => {
    const onSessionRetry = vi.fn();
    summaryAggregator.setOnSessionRetry(onSessionRetry);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          attempt: 2,
          message: "Your current subscription plan does not yet include access to GLM-5",
          next: 1772203141283,
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionRetry).toHaveBeenCalledWith({
      sessionId: "session-1",
      attempt: 2,
      message: "Your current subscription plan does not yet include access to GLM-5",
      next: 1772203141283,
    });
  });

  it("sends apply_patch payload as tool file", () => {
    const onToolFile = vi.fn();
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-apply-patch",
          tool: "apply_patch",
          state: {
            status: "completed",
            input: {
              patchText: "irrelevant for formatter in this path",
            },
            metadata: {
              filediff: {
                file: "D:/repo/src/one.ts",
                additions: 2,
                deletions: 1,
              },
              diff: [
                "@@ -1,2 +1,3 @@",
                "--- a/src/one.ts",
                "+++ b/src/one.ts",
                " old",
                "-before",
                "+after",
                "+extra",
              ].join("\n"),
            },
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).toHaveBeenCalledTimes(1);

    const filePayload = onToolFile.mock.calls[0][0] as {
      sessionId: string;
      tool: string;
      hasFileAttachment: boolean;
      fileData: {
        filename: string;
        buffer: Buffer;
      };
    };

    expect(filePayload.sessionId).toBe("session-1");
    expect(filePayload.tool).toBe("apply_patch");
    expect(filePayload.hasFileAttachment).toBe(true);
    expect(filePayload.fileData.filename).toBe("edit_one.ts.txt");
    expect(filePayload.fileData.buffer.toString("utf8")).toContain("Edit File/Path: src/one.ts");
  });

  it("sends apply_patch file using title and patchText fallback", () => {
    const onToolFile = vi.fn();
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-2",
          sessionID: "session-1",
          messageID: "message-2",
          type: "tool",
          callID: "call-apply-patch-fallback",
          tool: "apply_patch",
          state: {
            status: "completed",
            title: "Success. Updated the following files:\nM README.md",
            input: {
              patchText: [
                "--- a/README.md",
                "+++ b/README.md",
                "@@ -1,1 +1,2 @@",
                " old",
                "+new",
              ].join("\n"),
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).toHaveBeenCalledTimes(1);

    const filePayload = onToolFile.mock.calls[0][0] as {
      hasFileAttachment: boolean;
      fileData: {
        filename: string;
        buffer: Buffer;
      };
    };

    expect(filePayload.hasFileAttachment).toBe(true);
    expect(filePayload.fileData.filename).toBe("edit_README.md.txt");
    expect(filePayload.fileData.buffer.toString("utf8")).toContain("Edit File/Path: README.md");
  });
});
