import { afterEach, describe, expect, it } from "vitest";
import { renderSubagentCards } from "../../src/summary/subagent-formatter.js";
import { resetRuntimeLocale, setRuntimeLocale } from "../../src/i18n/index.js";

describe("summary/subagent-formatter", () => {
  afterEach(() => {
    resetRuntimeLocale();
  });

  it("renders subagent cards with requested OpenCode-like layout", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 54000,
          output: 10,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0.18,
        currentTool: "read",
        currentToolInput: {
          filePath: "src/pinned/manager.ts",
          offset: 1,
          limit: 280,
        },
        currentToolTitle: "Reading pinned manager",
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("🧩 Task: task description");
    expect(text).toContain("Agent: explore");
    expect(text).toContain("Model: openai/gpt-5.4");
    expect(text).not.toContain("Context:");
    expect(text).not.toContain("Cost:");
    expect(text).toContain("📖 read src/pinned/manager.ts");
    expect(text).not.toContain("Working:");
  });

  it("localizes labels and shows terminal completion state", async () => {
    setRuntimeLocale("ru");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "описание",
        prompt: "описание",
        status: "completed",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 1000,
          output: 10,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("🧩 Задача: описание");
    expect(text).toContain("Агент: explore");
    expect(text).toContain("Модель: openai/gpt-5.4");
    expect(text).toContain("✅ Завершена");
  });

  it("shows error message on failed subagent", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "error",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        terminalMessage: "Permission denied",
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("❌ Permission denied");
  });

  it("shows idle working state when no tool call is active", async () => {
    setRuntimeLocale("ru");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "описание",
        prompt: "описание",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("⚙️ В работе...");
  });

  it("falls back to working state when tool event has no details yet", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        currentTool: "read",
        currentToolInput: {},
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("⚙️ Working...");
    expect(text).not.toContain("📖 read\n");
  });

  it("uses input details instead of internal titles for running subagent tools", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCards([
      {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        currentTool: "grep",
        currentToolInput: {
          pattern: "[WARN]|[ERROR]",
        },
        currentToolTitle: "22460fc65b183e6921717bba0c84ccfcf4b57982",
        updatedAt: Date.now(),
      },
      {
        cardId: "card-2",
        sessionId: "child-2",
        parentSessionId: "root-1",
        agent: "explore",
        description: "read task",
        prompt: "read task",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        currentTool: "read",
        currentToolInput: {
          filePath: "src/summary/subagent-formatter.ts",
        },
        currentToolTitle: "22460fc65b183e6921717bba0c84ccfcf4b57982",
        updatedAt: Date.now(),
      },
      {
        cardId: "card-3",
        sessionId: "child-3",
        parentSessionId: "root-1",
        agent: "explore",
        description: "glob task",
        prompt: "glob task",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        currentTool: "glob",
        currentToolInput: {
          pattern: "**/*.ts",
        },
        currentToolTitle: "22460fc65b183e6921717bba0c84ccfcf4b57982",
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("🔍 grep [WARN]|[ERROR]");
    expect(text).toContain("📖 read src/summary/subagent-formatter.ts");
    expect(text).toContain("📁 glob **/*.ts");
    expect(text).not.toContain("22460fc65b183e6921717bba0c84ccfcf4b57982");
  });
});
