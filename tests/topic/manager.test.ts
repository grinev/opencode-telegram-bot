import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  const bindings = new Map<string, any>();

  const findBySessionId = (sessionId: string) => {
    for (const binding of bindings.values()) {
      if (binding.sessionId === sessionId) {
        return binding;
      }
    }

    return undefined;
  };

  return {
    bindings,
    getCurrentProjectMock: vi.fn(() => ({ id: "p1", worktree: "/repo" })),
    getScopedSessionsMock: vi.fn(() => ({})),
    findBySessionId,
  };
});

vi.mock("../../src/settings/manager.js", () => ({
  TOPIC_SESSION_STATUS: {
    ACTIVE: "active",
    CLOSED: "closed",
    STALE: "stale",
    ABANDONED: "abandoned",
    ERROR: "error",
  },
  clearTopicSessionBinding: vi.fn((bindingKey: string) => {
    mocked.bindings.delete(bindingKey);
  }),
  getCurrentProject: mocked.getCurrentProjectMock,
  getScopedSessions: mocked.getScopedSessionsMock,
  findTopicSessionBindingByScopeKey: vi.fn((scopeKey: string) => {
    return Array.from(mocked.bindings.values()).find((binding) => binding.scopeKey === scopeKey);
  }),
  findTopicSessionBindingBySessionId: vi.fn((sessionId: string) =>
    mocked.findBySessionId(sessionId),
  ),
  getTopicSessionBinding: vi.fn((bindingKey: string) => mocked.bindings.get(bindingKey)),
  getTopicSessionBindings: vi.fn(() => Object.fromEntries(mocked.bindings.entries())),
  getTopicSessionBindingsByChat: vi.fn((chatId: number) =>
    Array.from(mocked.bindings.values()).filter((binding) => binding.chatId === chatId),
  ),
  setTopicSessionBinding: vi.fn((bindingKey: string, binding: unknown) => {
    mocked.bindings.set(bindingKey, binding);
  }),
  updateTopicSessionBindingStatus: vi.fn(),
}));

vi.mock("../../src/session/manager.js", () => ({
  getScopeForSession: vi.fn(() => null),
}));

vi.mock("../../src/bot/scope.js", () => ({
  SCOPE_CONTEXT: {
    DM: "dm",
    GROUP_GENERAL: "group-general",
    GROUP_TOPIC: "group-topic",
  },
  getScopeFromKey: vi.fn(() => null),
}));

import {
  createTopicBindingKey,
  getSessionRouteTarget,
  registerTopicSessionBinding,
} from "../../src/topic/manager.js";

describe("topic/manager", () => {
  beforeEach(() => {
    mocked.bindings.clear();
    mocked.getCurrentProjectMock.mockClear();
    mocked.getScopedSessionsMock.mockReturnValue({});
  });

  it("rebinds session to new topic instead of throwing", () => {
    mocked.bindings.set(createTopicBindingKey(-100, 11), {
      scopeKey: "-100:11",
      chatId: -100,
      threadId: 11,
      sessionId: "ses-1",
      projectId: "p1",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });

    registerTopicSessionBinding({
      scopeKey: "-200:22",
      chatId: -200,
      threadId: 22,
      sessionId: "ses-1",
      projectId: "p2",
      status: "active",
    });

    expect(mocked.bindings.get(createTopicBindingKey(-100, 11))).toBeUndefined();
    expect(mocked.bindings.get(createTopicBindingKey(-200, 22))).toMatchObject({
      sessionId: "ses-1",
      scopeKey: "-200:22",
    });
  });

  it("returns route target from binding when available", () => {
    mocked.bindings.set(createTopicBindingKey(-300, 33), {
      scopeKey: "-300:33",
      chatId: -300,
      threadId: 33,
      sessionId: "ses-2",
      projectId: "p1",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });

    const target = getSessionRouteTarget("ses-2");

    expect(target).toEqual({
      scopeKey: "-300:33",
      chatId: -300,
      threadId: 33,
    });
  });
});
