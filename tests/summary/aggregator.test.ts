import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { summaryAggregator } from "../../src/summary/aggregator.js";
import { __resetSettingsForTests, setCurrentProject } from "../../src/settings/manager.js";

describe("summary/aggregator", () => {
  beforeEach(() => {
    __resetSettingsForTests();
    setCurrentProject({ id: "p1", worktree: "D:/repo", name: "repo" });
    summaryAggregator.clear();
    summaryAggregator.setOnCleared(() => {});
    summaryAggregator.setOnTool(() => {});
    summaryAggregator.setOnToolFile(() => {});
    summaryAggregator.setOnThinking(() => {});
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

  it("passes sessionId to thinking callback", async () => {
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

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledWith("session-1");
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
