import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { summaryAggregator } from "../../../src/app/managers/summary-aggregation-manager.js";
import { logger } from "../../../src/utils/logger.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
}));

vi.mock("../../../src/app/stores/settings-store.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/app/stores/settings-store.js")>(
    "../../../src/app/stores/settings-store.js",
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
    summaryAggregator.setOnRootToolUpdate(() => {});
    summaryAggregator.setOnToolFile(() => {});
    summaryAggregator.setOnPartial(() => {});
    summaryAggregator.setOnExternalUserInput(() => {});
    summaryAggregator.setOnThinking(() => {});
    summaryAggregator.setOnThinkingFinished(() => {});
    summaryAggregator.setOnSubagent(() => {});
    summaryAggregator.setOnSessionIdle(() => {});
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

  it("emits root tool updates before completion filtering", () => {
    const onRootToolUpdate = vi.fn();
    summaryAggregator.setOnRootToolUpdate(onRootToolUpdate);
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
          callID: "call-task",
          tool: "task",
          state: {
            status: "running",
            input: {
              description: "Explore repo",
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onRootToolUpdate).toHaveBeenCalledTimes(1);
    expect(onRootToolUpdate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        callId: "call-task",
        tool: "task",
        hasFileAttachment: false,
      }),
    );
  });

  it("does not emit root tool updates for unrelated child sessions", () => {
    const onRootToolUpdate = vi.fn();
    summaryAggregator.setOnRootToolUpdate(onRootToolUpdate);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "child-session",
          messageID: "message-1",
          type: "tool",
          callID: "child-call",
          tool: "bash",
          state: {
            status: "running",
            input: {
              command: "npm test",
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onRootToolUpdate).not.toHaveBeenCalled();
  });

  it("emits live subagent updates with per-session model, context, cost, and current tool", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "Inspect pinned manager",
          description: "task description",
          agent: "explore",
          command: "inspect",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task-tool-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "tool",
          callID: "task-call-1",
          tool: "task",
          state: {
            status: "running",
            input: {
              description: "Explore project architecture",
              subagent_type: "explore",
              prompt: "Inspect architecture",
            },
            title: "Launching subagent",
            metadata: {},
            time: { start: Date.now() },
          },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-session-1",
          parentID: "root-session",
          title: "Explore project architecture (@explore subagent)",
          slug: "child",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "child-message-1",
          sessionID: "child-session-1",
          role: "assistant",
          parentID: "root-message",
          providerID: "openai",
          modelID: "gpt-5.4",
          agent: "explore",
          path: { cwd: "D:/repo", root: "D:/repo" },
          mode: "all",
          cost: 0.18,
          tokens: {
            input: 54000,
            output: 1200,
            reasoning: 0,
            cache: { read: 1000, write: 0 },
          },
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "child-tool-1",
          sessionID: "child-session-1",
          messageID: "child-message-1",
          type: "tool",
          callID: "call-child-1",
          tool: "read",
          state: {
            status: "running",
            input: {
              filePath: "src/bot/pinned/pinned-message-manager.ts",
              offset: 1,
              limit: 280,
            },
            title: "Reading pinned manager",
            metadata: {},
            time: { start: Date.now() },
          },
        },
      },
    } as unknown as Event);

    expect(onSubagent).toHaveBeenCalled();
    expect(onSubagent.mock.lastCall?.[0]).toBe("root-session");
    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({
        sessionId: "child-session-1",
        parentSessionId: "root-session",
        agent: "explore",
        description: "Explore project architecture",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        cost: 0.18,
        currentTool: "read",
        currentToolTitle: "Reading pinned manager",
        currentToolInput: expect.objectContaining({
          filePath: "src/bot/pinned/pinned-message-manager.ts",
          offset: 1,
          limit: 280,
        }),
        tokens: expect.objectContaining({
          input: 54000,
          cacheRead: 1000,
        }),
      }),
    ]);
  });

  describe("subagent current tool timing", () => {
    function startSubagent(): void {
      summaryAggregator.setSession("root-session");

      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: "subtask-1",
            sessionID: "root-session",
            messageID: "root-message",
            type: "subtask",
            prompt: "Inspect pinned manager",
            description: "task description",
            agent: "explore",
            command: "inspect",
          },
        },
      } as unknown as Event);

      summaryAggregator.processEvent({
        type: "session.created",
        properties: {
          info: {
            id: "child-session-1",
            parentID: "root-session",
            title: "task description (@explore subagent)",
            slug: "child",
            directory: "D:/repo",
            projectID: "p1",
            version: "1",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as unknown as Event);
    }

    function emitChildTool(callID: string): void {
      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: `child-tool-${callID}`,
            sessionID: "child-session-1",
            messageID: "child-message-1",
            type: "tool",
            callID,
            tool: "bash",
            state: {
              status: "running",
              input: { command: "npm test" },
              title: "Running tests",
              metadata: {},
              time: { start: Date.now() },
            },
          },
        },
      } as unknown as Event);
    }

    it("reports the current tool call id and its start time", () => {
      const onSubagent = vi.fn();
      summaryAggregator.setOnSubagent(onSubagent);
      startSubagent();

      emitChildTool("call-1");

      expect(onSubagent.mock.lastCall?.[1]).toEqual([
        expect.objectContaining({
          currentTool: "bash",
          currentToolCallId: "call-1",
          currentToolStartedAt: expect.any(Number),
        }),
      ]);
    });

    it("does not re-emit while the same call keeps reporting", () => {
      const onSubagent = vi.fn();
      summaryAggregator.setOnSubagent(onSubagent);
      startSubagent();

      emitChildTool("call-1");
      const callsAfterFirst = onSubagent.mock.calls.length;
      emitChildTool("call-1");

      expect(onSubagent.mock.calls).toHaveLength(callsAfterFirst);
    });

    it("stamps finishedAt when the subagent session goes idle", () => {
      const onSubagent = vi.fn();
      summaryAggregator.setOnSubagent(onSubagent);
      startSubagent();
      emitChildTool("call-1");

      summaryAggregator.processEvent({
        type: "session.idle",
        properties: { sessionID: "child-session-1" },
      } as unknown as Event);

      const card = onSubagent.mock.lastCall?.[1][0];
      expect(card.status).toBe("completed");
      expect(card.finishedAt).toEqual(expect.any(Number));
      expect(card.finishedAt).toBeGreaterThanOrEqual(card.createdAt);
      expect(card.currentToolStartedAt).toBeUndefined();
    });

    it("re-emits and restarts timing for an identical tool with a new call id", async () => {
      const onSubagent = vi.fn();
      summaryAggregator.setOnSubagent(onSubagent);
      startSubagent();

      emitChildTool("call-1");
      const firstStartedAt = onSubagent.mock.lastCall?.[1][0].currentToolStartedAt as number;
      const callsAfterFirst = onSubagent.mock.calls.length;

      await new Promise((resolve) => setTimeout(resolve, 5));
      emitChildTool("call-2");

      expect(onSubagent.mock.calls.length).toBeGreaterThan(callsAfterFirst);
      expect(onSubagent.mock.lastCall?.[1][0].currentToolCallId).toBe("call-2");
      expect(
        onSubagent.mock.lastCall?.[1][0].currentToolStartedAt as number,
      ).toBeGreaterThan(firstStartedAt);
    });
  });

  it("attaches unknown child session events to pending subagent cards before session.created", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "Explore architecture",
          description: "Explore architecture",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "child-unknown",
          messageID: "child-message-1",
          type: "step-finish",
          reason: "done",
          cost: 0.12,
          snapshot: "step snapshot",
          tokens: {
            input: 1000,
            output: 50,
            reasoning: 0,
            cache: { read: 200, write: 0 },
          },
        },
      },
    } as unknown as Event);

    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({
        sessionId: "child-unknown",
        cost: 0.12,
        tokens: expect.objectContaining({ input: 1000, cacheRead: 200 }),
        currentToolTitle: "step snapshot",
      }),
    ]);
  });

  it("tracks multiple parallel subagents independently", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    const subtasks = [
      { id: "subtask-1", agent: "explore", description: "first task", child: "child-1" },
      { id: "subtask-2", agent: "general", description: "second task", child: "child-2" },
    ];

    for (const item of subtasks) {
      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: item.id,
            sessionID: "root-session",
            messageID: "root-message",
            type: "subtask",
            prompt: item.description,
            description: item.description,
            agent: item.agent,
          },
        },
      } as unknown as Event);

      summaryAggregator.processEvent({
        type: "session.created",
        properties: {
          info: {
            id: item.child,
            parentID: "root-session",
            title: `${item.description} (@${item.agent} subagent)`,
            slug: item.child,
            directory: "D:/repo",
            projectID: "p1",
            version: "1",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as unknown as Event);

      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: `tool-${item.child}`,
            sessionID: item.child,
            messageID: `message-${item.child}`,
            type: "tool",
            callID: `call-${item.child}`,
            tool: "bash",
            state: {
              status: "running",
              input: { command: `echo ${item.child}` },
              title: `Running ${item.child}`,
              metadata: {},
              time: { start: Date.now() },
            },
          },
        },
      } as unknown as Event);
    }

    expect(onSubagent.mock.lastCall?.[1]).toHaveLength(2);
    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({
        sessionId: "child-1",
        description: "first task",
        agent: "explore",
      }),
      expect.objectContaining({
        sessionId: "child-2",
        description: "second task",
        agent: "general",
      }),
    ]);
  });

  it("keeps subagent cards and updates terminal status for child sessions", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "done task",
          description: "done task",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-done",
          parentID: "root-session",
          title: "done task (@explore subagent)",
          slug: "child-done",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "child-done",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-2",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "failed task",
          description: "failed task",
          agent: "general",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-error",
          parentID: "root-session",
          title: "failed task (@general subagent)",
          slug: "child-error",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.error",
      properties: {
        sessionID: "child-error",
        error: {
          data: { message: "Task failed" },
        },
      },
    } as unknown as Event);

    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ sessionId: "child-done", status: "completed" }),
      expect.objectContaining({
        sessionId: "child-error",
        status: "error",
        terminalMessage: "Task failed",
      }),
    ]);
  });

  it("does not re-emit completed subagent cards for unchanged late child session updates", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "done task",
          description: "done task",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-done",
          parentID: "root-session",
          title: "done task (@explore subagent)",
          slug: "child-done",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "child-done",
      },
    } as unknown as Event);

    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ sessionId: "child-done", status: "completed" }),
    ]);
    const callsAfterIdle = onSubagent.mock.calls.length;

    summaryAggregator.processEvent({
      type: "session.updated",
      properties: {
        info: {
          id: "child-done",
          parentID: "root-session",
          title: "done task (@explore subagent)",
          slug: "child-done",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() + 1000 },
        },
      },
    } as unknown as Event);

    expect(onSubagent).toHaveBeenCalledTimes(callsAfterIdle);
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

  it("passes reasoning sections to thinking callback when reasoning part arrives", async () => {
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

    expect(onThinking).toHaveBeenCalledWith({
      sessionId: "session-1",
      messageId: "message-1",
      isFirstUpdate: true,
      sections: [
        {
          id: "part-reasoning-1",
          text: "Let me think about this...",
        },
      ],
    });
  });

  it("streams explicit reasoning deltas without adding them to assistant text", async () => {
    const onThinking = vi.fn();
    const onPartial = vi.fn();
    const onComplete = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-delta",
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
          id: "reasoning-delta-part",
          sessionID: "session-1",
          messageID: "message-reasoning-delta",
          type: "reasoning",
          title: "Analysis",
          text: "First ",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "reasoning-delta-part",
          sessionID: "session-1",
          messageID: "message-reasoning-delta",
          type: "reasoning",
        },
        delta: "second",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "answer-part",
          sessionID: "session-1",
          messageID: "message-reasoning-delta",
          type: "text",
          text: "Final answer.",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-delta",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      messageId: "message-reasoning-delta",
      isFirstUpdate: false,
      sections: [
        {
          id: "reasoning-delta-part",
          title: "Analysis",
          text: "First second",
        },
      ],
    });
    expect(onPartial).toHaveBeenCalledWith("session-1", "message-reasoning-delta", "Final answer.");
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-reasoning-delta",
      "Final answer.",
      expect.any(Object),
    );
  });

  it("signals thinking finished once when assistant text starts after reasoning", async () => {
    const onThinkingFinished = vi.fn();
    summaryAggregator.setOnThinkingFinished(onThinkingFinished);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-thinking-finished",
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
          id: "reasoning-part",
          sessionID: "session-1",
          messageID: "message-thinking-finished",
          type: "reasoning",
          text: "Thinking...",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-part",
          sessionID: "session-1",
          messageID: "message-thinking-finished",
          type: "text",
          text: "Answer start",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "text-part",
          sessionID: "session-1",
          messageID: "message-thinking-finished",
          type: "text",
        },
        delta: " continues",
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinkingFinished).toHaveBeenCalledTimes(1);
    expect(onThinkingFinished).toHaveBeenCalledWith(
      "session-1",
      "message-thinking-finished",
    );
  });

  it("does not signal thinking finished for assistant text without reasoning", async () => {
    const onThinkingFinished = vi.fn();
    summaryAggregator.setOnThinkingFinished(onThinkingFinished);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-no-thinking-finished",
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
          id: "text-part",
          sessionID: "session-1",
          messageID: "message-no-thinking-finished",
          type: "text",
          text: "Answer only",
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinkingFinished).not.toHaveBeenCalled();
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
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-stream-1",
      "Partial answer",
      expect.objectContaining({}),
    );
  });

  it("emits completed external user input for the current session", async () => {
    const onExternalUserInput = vi.fn();
    summaryAggregator.setOnExternalUserInput(onExternalUserInput);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-user-1",
          sessionID: "session-1",
          messageID: "message-user-1",
          type: "text",
          text: "Check the failing tests",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-user-1",
          sessionID: "session-1",
          role: "user",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onExternalUserInput).toHaveBeenCalledWith(
      "session-1",
      "message-user-1",
      "Check the failing tests",
    );
  });

  it("ignores external user input from a different session", async () => {
    const onExternalUserInput = vi.fn();
    summaryAggregator.setOnExternalUserInput(onExternalUserInput);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-user-other",
          sessionID: "session-2",
          messageID: "message-user-other",
          type: "text",
          text: "Hello from another session",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-user-other",
          sessionID: "session-2",
          role: "user",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onExternalUserInput).not.toHaveBeenCalled();
  });

  it("does not emit whitespace-only external user input", async () => {
    const onExternalUserInput = vi.fn();
    summaryAggregator.setOnExternalUserInput(onExternalUserInput);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-user-empty",
          sessionID: "session-1",
          messageID: "message-user-empty",
          type: "text",
          text: "   ",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-user-empty",
          sessionID: "session-1",
          role: "user",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onExternalUserInput).not.toHaveBeenCalled();
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
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-multipart-1",
      "Hello world",
      expect.objectContaining({}),
    );
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
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-pending-complete",
      "Final text",
      expect.objectContaining({}),
    );
  });

  it("reports root session.idle through callback", async () => {
    const onSessionIdle = vi.fn();
    summaryAggregator.setOnSessionIdle(onSessionIdle);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionIdle).toHaveBeenCalledWith("session-1");
  });

  it("passes assistant metadata to onComplete", () => {
    const onComplete = vi.fn();
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-meta-1",
          sessionID: "session-1",
          role: "assistant",
          agent: "plan",
          providerID: "openai",
          modelID: "gpt-5.4",
          time: { created: 1000 },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-meta-1",
          sessionID: "session-1",
          messageID: "message-meta-1",
          type: "text",
          text: "Done",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-meta-1",
          sessionID: "session-1",
          role: "assistant",
          agent: "plan",
          providerID: "openai",
          modelID: "gpt-5.4",
          time: { created: 1000, completed: 2500 },
        },
      },
    } as unknown as Event);

    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-meta-1",
      "Done",
      expect.objectContaining({
        agent: "plan",
        providerID: "openai",
        modelID: "gpt-5.4",
        createdAt: 1000,
        completedAt: 2500,
      }),
    );
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

  it("streams all reasoning parts and marks only the first thinking update", async () => {
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

    expect(onThinking).toHaveBeenCalledTimes(3);
    expect(onThinking.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        messageId: "message-multi-reasoning",
        isFirstUpdate: true,
        sections: [{ id: "part-reasoning-0", text: "Thinking step 0" }],
      }),
    );
    expect(onThinking.mock.calls[2][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        messageId: "message-multi-reasoning",
        isFirstUpdate: false,
        sections: [
          { id: "part-reasoning-0", text: "Thinking step 0" },
          { id: "part-reasoning-1", text: "Thinking step 1" },
          { id: "part-reasoning-2", text: "Thinking step 2" },
        ],
      }),
    );
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

  it("fires onTokens with isCompleted=true when message has completed timestamp", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setOnComplete(() => {});
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-tokens-completed",
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
          id: "part-text-tokens",
          sessionID: "session-1",
          messageID: "msg-tokens-completed",
          type: "text",
          text: "Done",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-tokens-completed",
          sessionID: "session-1",
          role: "assistant",
          tokens: { input: 800, output: 200, reasoning: 0, cache: { read: 100, write: 0 } },
          cost: 0.01,
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ input: 800, output: 200, cacheRead: 100 }),
      true,
    );
  });

  it("fires onTokens with isCompleted=false for non-completed message with tokens", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-tokens-intermediate",
          sessionID: "session-1",
          role: "assistant",
          tokens: { input: 500, output: 50, reasoning: 0, cache: { read: 200, write: 0 } },
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ input: 500, output: 50, cacheRead: 200 }),
      false,
    );
  });

  it("fires onTokens for non-completed message with non-zero tokens (intermediate update)", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setSession("session-1");

    // First message with zero tokens (new message starting)
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-step2",
          sessionID: "session-1",
          role: "assistant",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    // The callback IS fired (filtering zero tokens is done at bot/index.ts level)
    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ input: 0, cacheRead: 0 }),
      false,
    );

    onTokens.mockClear();

    // Later update with real tokens
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-step2",
          sessionID: "session-1",
          role: "assistant",
          tokens: { input: 4000, output: 300, reasoning: 0, cache: { read: 12000, write: 0 } },
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ input: 4000, cacheRead: 12000 }),
      false,
    );
  });

  it("does not fire onTokens when message.updated has no tokens field", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-no-tokens",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).not.toHaveBeenCalled();
  });

  it("forwards permission.asked events from tracked subagent (child) sessions", async () => {
    const onPermission = vi.fn();
    summaryAggregator.setOnPermission(onPermission);
    summaryAggregator.setSession("root-session");

    // Register a tracked child session via the task tool flow.
    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "Edit file",
          description: "Edit file",
          agent: "general",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-session-1",
          parentID: "root-session",
          title: "Edit file (@general subagent)",
          slug: "child",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    // permission.asked from the child (subagent) session must reach the callback.
    summaryAggregator.processEvent({
      type: "permission.asked",
      properties: {
        id: "req-child-1",
        sessionID: "child-session-1",
        permission: "write",
        patterns: ["src/foo.ts"],
        metadata: {},
        always: [],
      },
    } as unknown as Event);

    await vi.waitFor(() => {
      expect(onPermission).toHaveBeenCalledTimes(1);
    });
    expect(onPermission.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        id: "req-child-1",
        sessionID: "child-session-1",
        permission: "write",
      }),
    );
    expect(summaryAggregator.isSubagentSession("child-session-1")).toBe(true);
  });

  it("serializes permission callbacks so equivalent requests can be registered before the next dispatch", async () => {
    let releaseFirstPermission: () => void = () => {};
    const firstPermissionDone = new Promise<void>((resolve) => {
      releaseFirstPermission = resolve;
    });
    const calls: string[] = [];

    summaryAggregator.setOnPermission(async (request) => {
      calls.push(`start:${request.id}`);

      if (request.id === "req-1") {
        await firstPermissionDone;
      }

      calls.push(`end:${request.id}`);
    });
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "permission.asked",
      properties: {
        id: "req-1",
        sessionID: "session-1",
        permission: "bash",
        patterns: ["pwd"],
        metadata: {},
        always: [],
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "permission.asked",
      properties: {
        id: "req-2",
        sessionID: "session-1",
        permission: "bash",
        patterns: ["pwd"],
        metadata: {},
        always: [],
      },
    } as unknown as Event);

    await vi.waitFor(() => {
      expect(calls).toEqual(["start:req-1"]);
    });

    releaseFirstPermission();

    await vi.waitFor(() => {
      expect(calls).toEqual(["start:req-1", "end:req-1", "start:req-2", "end:req-2"]);
    });
  });

  it("ignores permission.asked events from unrelated sessions", async () => {
    const onPermission = vi.fn();
    summaryAggregator.setOnPermission(onPermission);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "permission.asked",
      properties: {
        id: "req-other",
        sessionID: "some-other-session",
        permission: "write",
        patterns: ["src/foo.ts"],
        metadata: {},
        always: [],
      },
    } as unknown as Event);

    await new Promise((resolve) => setImmediate(resolve));

    expect(onPermission).not.toHaveBeenCalled();
    expect(summaryAggregator.isSubagentSession("some-other-session")).toBe(false);
  });

  it("drops the upstream empty-response placeholder instead of showing it to the user", async () => {
    const onPartial = vi.fn();
    const onComplete = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-empty-response",
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
          id: "empty-response-part",
          sessionID: "session-1",
          messageID: "message-empty-response",
          type: "text",
          text: "Empty response: {'content': [{'type': 'thinking'}], 'stop_reason': 'end_turn'}",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-empty-response",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    // Nothing is left to send, so the run completes silently - same as when the
    // provider returns no text part at all.
    expect(onPartial).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("reports an empty completed response at session idle with final metadata", () => {
    const onComplete = vi.fn();
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-empty-final");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-empty-final",
          sessionID: "session-empty-final",
          role: "assistant",
          finish: "unknown",
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          time: { created: 1 },
        },
      },
    } as unknown as Event);

    for (const type of ["step-start", "step-finish"] as const) {
      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: `${type}-1`,
            sessionID: "session-empty-final",
            messageID: "message-empty-final",
            type,
            ...(type === "step-finish"
              ? {
                  reason: "unknown",
                  cost: 0,
                  tokens: {
                    input: 0,
                    output: 0,
                    reasoning: 0,
                    cache: { read: 0, write: 0 },
                  },
                }
              : {}),
          },
        },
      } as unknown as Event);
    }

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-empty-final",
          sessionID: "session-empty-final",
          role: "assistant",
          finish: "unknown",
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          time: { created: 1, completed: 2 },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: { sessionID: "session-empty-final" },
    } as unknown as Event);

    expect(onComplete).toHaveBeenCalledWith(
      "session-empty-final",
      "message-empty-final",
      "",
      expect.objectContaining({
        finishReason: "unknown",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        hasToolActivity: false,
        hasReasoningActivity: false,
      }),
    );
  });

  it("drops the empty-response placeholder while it is still streaming in", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-empty-streaming",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    for (const delta of ["Empty", " resp", "onse: ", "{'content'"]) {
      summaryAggregator.processEvent({
        type: "message.part.delta",
        properties: {
          part: {
            id: "empty-streaming-part",
            sessionID: "session-1",
            messageID: "message-empty-streaming",
            type: "text",
          },
          delta,
        },
      } as unknown as Event);
    }

    expect(onPartial).not.toHaveBeenCalled();
  });

  it("delivers user text that looks like the empty-response placeholder unfiltered", async () => {
    const onExternalUserInput = vi.fn();
    summaryAggregator.setOnExternalUserInput(onExternalUserInput);
    summaryAggregator.setSession("session-1");

    const userText = "Empty response: {'content': [{'type': 'thinking'}]} - why do I get this?";

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-user-marker",
          sessionID: "session-1",
          messageID: "message-user-marker",
          type: "text",
          text: userText,
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-user-marker",
          sessionID: "session-1",
          role: "user",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onExternalUserInput).toHaveBeenCalledWith("session-1", "message-user-marker", userText);
  });

  it("recovers streamed text that diverges from the marker mid-stream", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-empty-diverging",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    // "Empty resp" is still a prefix of the marker and stays suppressed, but the
    // next chunk diverges from it and the whole text has to surface.
    for (const delta of ["Empty resp", "onse from the server, retrying."]) {
      summaryAggregator.processEvent({
        type: "message.part.delta",
        properties: {
          part: {
            id: "diverging-part",
            sessionID: "session-1",
            messageID: "message-empty-diverging",
            type: "text",
          },
          delta,
        },
      } as unknown as Event);
    }

    expect(onPartial).toHaveBeenLastCalledWith(
      "session-1",
      "message-empty-diverging",
      "Empty response from the server, retrying.",
    );
  });

  it("releases a completed answer that legitimately opens with the marker", async () => {
    const onComplete = vi.fn();
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    // The user can ask the model to start its reply with that exact line. It is
    // held back while streaming, but the completed text carries no serialized
    // response object, so it must reach the user.
    const answer = "Empty response: {'content': 'test'} is what the provider sends back.";

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-legit-marker",
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
          id: "legit-marker-part",
          sessionID: "session-1",
          messageID: "message-legit-marker",
          type: "text",
          text: answer,
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-legit-marker",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-legit-marker",
      answer,
      expect.any(Object),
    );
  });

  it("keeps assistant text that only starts like the empty-response placeholder", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-empty-lookalike",
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
          id: "lookalike-part",
          sessionID: "session-1",
          messageID: "message-empty-lookalike",
          type: "text",
          text: "Empty response body is expected here.",
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledWith(
      "session-1",
      "message-empty-lookalike",
      "Empty response body is expected here.",
    );
  });

  it("ignores synthetic text parts so an attached file is not echoed into the chat", async () => {
    const onExternalUserInput = vi.fn();
    summaryAggregator.setOnExternalUserInput(onExternalUserInput);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-user",
          sessionID: "session-1",
          role: "user",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-prompt",
          sessionID: "session-1",
          messageID: "message-user",
          type: "text",
          text: "what does this file do?",
        },
      },
    } as unknown as Event);

    // OpenCode expands a file:// attachment into synthetic parts carrying the whole file.
    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-synthetic",
          sessionID: "session-1",
          messageID: "message-user",
          type: "text",
          synthetic: true,
          text: "Called the Read tool with the following input: {}\n1: SECRET_FILE_CONTENT",
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setImmediate(resolve));

    for (const call of onExternalUserInput.mock.calls) {
      expect(call[2]).not.toContain("SECRET_FILE_CONTENT");
      expect(call[2]).not.toContain("Called the Read tool");
    }
  });

  it("ignores deltas streamed for a part already known to be synthetic", async () => {
    const onExternalUserInput = vi.fn();
    summaryAggregator.setOnExternalUserInput(onExternalUserInput);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-user-delta",
          sessionID: "session-1",
          role: "user",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-synthetic-streamed",
          sessionID: "session-1",
          messageID: "message-user-delta",
          type: "text",
          synthetic: true,
          text: "Called the Read tool with the following input: {}",
        },
      },
    } as unknown as Event);

    // Delta events often carry only the part id, so the flag must be remembered.
    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "part-synthetic-streamed",
          sessionID: "session-1",
          messageID: "message-user-delta",
        },
        delta: "\n1: SECRET_STREAMED_CONTENT",
      },
    } as unknown as Event);

    await new Promise((resolve) => setImmediate(resolve));

    for (const call of onExternalUserInput.mock.calls) {
      expect(call[2]).not.toContain("SECRET_STREAMED_CONTENT");
    }
  });

  it("ignores a delta whose own part is flagged synthetic", async () => {
    const onExternalUserInput = vi.fn();
    summaryAggregator.setOnExternalUserInput(onExternalUserInput);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-user-delta-first",
          sessionID: "session-1",
          role: "user",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "part-synthetic-first",
          sessionID: "session-1",
          messageID: "message-user-delta-first",
          type: "text",
          synthetic: true,
        },
        delta: "1: SECRET_FIRST_DELTA",
      },
    } as unknown as Event);

    await new Promise((resolve) => setImmediate(resolve));

    for (const call of onExternalUserInput.mock.calls) {
      expect(call[2]).not.toContain("SECRET_FIRST_DELTA");
    }
  });

  describe("unexpected event shapes", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("warns and skips a message.part.delta whose properties are not an object", () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const onPartial = vi.fn();
      summaryAggregator.setOnPartial(onPartial);
      summaryAggregator.setSession("session-1");

      summaryAggregator.processEvent({
        type: "message.part.delta",
        properties: null,
      } as unknown as Event);
      summaryAggregator.processEvent({
        type: "message.part.delta",
      } as unknown as Event);

      expect(warnSpy).toHaveBeenCalledWith(
        "[Aggregator] message.part.delta with unexpected shape, ignoring",
      );
      expect(onPartial).not.toHaveBeenCalled();
    });

    it("falls back to a generic message and warns when session.error carries a non-object error", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const onSessionError = vi.fn();
      summaryAggregator.setOnSessionError(onSessionError);
      summaryAggregator.setSession("session-1");

      summaryAggregator.processEvent({
        type: "session.error",
        properties: {
          sessionID: "session-1",
          error: 42,
        },
      } as unknown as Event);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(onSessionError).toHaveBeenCalledWith("session-1", "Unknown session error");
      expect(warnSpy).toHaveBeenCalled();
    });

    it("surfaces a string session.error with a warn instead of the generic fallback", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const onSessionError = vi.fn();
      summaryAggregator.setOnSessionError(onSessionError);
      summaryAggregator.setSession("session-1");

      summaryAggregator.processEvent({
        type: "session.error",
        properties: {
          sessionID: "session-1",
          error: "upstream exploded",
        },
      } as unknown as Event);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(onSessionError).toHaveBeenCalledWith("session-1", "upstream exploded");
      expect(warnSpy).toHaveBeenCalled();
    });

    it("passes a reasoning part without title keys to the thinking callback without a title", async () => {
      const onThinking = vi.fn();
      summaryAggregator.setOnThinking(onThinking);
      summaryAggregator.setSession("session-1");

      summaryAggregator.processEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "message-no-title",
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
            id: "part-reasoning-no-title",
            sessionID: "session-1",
            messageID: "message-no-title",
            type: "reasoning",
            text: "Just thinking",
            time: { start: Date.now() },
          },
        },
      } as unknown as Event);

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(onThinking).toHaveBeenCalledWith({
        sessionId: "session-1",
        messageId: "message-no-title",
        isFirstUpdate: true,
        sections: [{ id: "part-reasoning-no-title", text: "Just thinking" }],
      });
    });

    it("does not crash when a completed tool part carries non-object metadata", () => {
      const onTool = vi.fn();
      summaryAggregator.setOnTool(onTool);
      summaryAggregator.setSession("session-1");

      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part-tool-weird-meta",
            sessionID: "session-1",
            messageID: "message-1",
            type: "tool",
            callID: "call-weird-meta",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "ls" },
              title: "ls",
              metadata: "not-an-object",
              time: { start: Date.now(), end: Date.now() },
            },
          },
        },
      } as unknown as Event);

      expect(onTool).toHaveBeenCalledTimes(1);
      expect(onTool).toHaveBeenCalledWith(
        expect.objectContaining({ callId: "call-weird-meta", tool: "bash" }),
      );
    });
  });
});
