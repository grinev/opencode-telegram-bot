import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  let currentProject:
    | {
        id: string;
        worktree: string;
        name: string;
      }
    | undefined;
  let currentSession:
    | {
        id: string;
        directory: string;
        title: string;
      }
    | undefined;
  let currentAgent: string | undefined;

  const appAgentsMock = vi.fn();
  const sessionMessagesMock = vi.fn();
  const getCurrentProjectMock = vi.fn(() => currentProject);
  const getCurrentSessionMock = vi.fn(() => currentSession);
  const getCurrentAgentMock = vi.fn(() => currentAgent);
  const setCurrentAgentMock = vi.fn((agentName: string) => {
    currentAgent = agentName;
  });

  return {
    appAgentsMock,
    sessionMessagesMock,
    getCurrentProjectMock,
    getCurrentSessionMock,
    getCurrentAgentMock,
    setCurrentAgentMock,
    loggerDebugMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    loggerInfoMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    setCurrentProject: (project?: { id: string; worktree: string; name: string }) => {
      currentProject = project;
    },
    setCurrentSession: (session?: { id: string; directory: string; title: string }) => {
      currentSession = session;
    },
    setCurrentAgent: (agentName?: string) => {
      currentAgent = agentName;
    },
  };
});

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    app: {
      agents: mocked.appAgentsMock,
    },
    session: {
      messages: mocked.sessionMessagesMock,
    },
  },
}));

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
  getCurrentAgent: mocked.getCurrentAgentMock,
  setCurrentAgent: mocked.setCurrentAgentMock,
}));

vi.mock("../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    error: mocked.loggerErrorMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
  },
}));

import { fetchCurrentAgent, getAvailableAgents, resolveProjectAgent } from "../../src/agent/manager.js";

function createAgentResponse(
  agents: Array<{ name: string; mode: "primary" | "all" | "subagent"; hidden?: boolean }>,
) {
  return {
    data: agents,
    error: null,
  };
}

describe("agent/manager", () => {
  beforeEach(() => {
    mocked.appAgentsMock.mockReset();
    mocked.sessionMessagesMock.mockReset();
    mocked.getCurrentProjectMock.mockClear();
    mocked.getCurrentSessionMock.mockClear();
    mocked.getCurrentAgentMock.mockClear();
    mocked.setCurrentAgentMock.mockClear();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.setCurrentProject(undefined);
    mocked.setCurrentSession(undefined);
    mocked.setCurrentAgent(undefined);
  });

  it("filters out hidden agents and subagents", async () => {
    mocked.setCurrentProject({
      id: "project-1",
      worktree: "/workspace/project-1",
      name: "project-1",
    });
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "orchestrator", mode: "primary" },
        { name: "build", mode: "primary" },
        { name: "summary", mode: "primary", hidden: true },
        { name: "general", mode: "subagent" },
      ]),
    );

    const result = await getAvailableAgents();

    expect(result).toEqual([
      { name: "orchestrator", mode: "primary" },
      { name: "build", mode: "primary" },
    ]);
  });

  it("falls back to build when the preferred agent is unavailable in the project", async () => {
    mocked.setCurrentProject({
      id: "project-1",
      worktree: "/workspace/project-1",
      name: "project-1",
    });
    mocked.setCurrentAgent("orchestrator");
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "build", mode: "primary" },
        { name: "plan", mode: "primary" },
      ]),
    );

    const result = await resolveProjectAgent("orchestrator");

    expect(result).toBe("build");
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("build");
    expect(mocked.loggerWarnMock).toHaveBeenCalledOnce();
  });

  it("falls back to the first available agent when build is unavailable", async () => {
    mocked.setCurrentProject({
      id: "project-2",
      worktree: "/workspace/project-2",
      name: "project-2",
    });
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "plan", mode: "primary" },
        { name: "orchestrator", mode: "primary" },
      ]),
    );

    const result = await resolveProjectAgent("build");

    expect(result).toBe("plan");
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("plan");
  });

  it("normalizes an invalid stored agent when there is an active project without a session", async () => {
    mocked.setCurrentProject({
      id: "project-3",
      worktree: "/workspace/project-3",
      name: "project-3",
    });
    mocked.setCurrentAgent("orchestrator");
    mocked.appAgentsMock.mockResolvedValue(
      createAgentResponse([
        { name: "build", mode: "primary" },
        { name: "plan", mode: "primary" },
      ]),
    );

    const result = await fetchCurrentAgent();

    expect(result).toBe("build");
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("build");
    expect(mocked.sessionMessagesMock).not.toHaveBeenCalled();
  });
});
