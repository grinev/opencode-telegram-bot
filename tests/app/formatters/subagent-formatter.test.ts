import { afterEach, describe, expect, it } from "vitest";
import {
  renderSubagentCard,
  renderSubagentCards,
} from "../../../src/app/formatters/subagent-formatter.js";
import { resetRuntimeLocale, setRuntimeLocale } from "../../../src/i18n/index.js";

describe("summary/subagent-formatter", () => {
  afterEach(() => {
    resetRuntimeLocale();
  });

  it("renders subagent cards with requested OpenCode-like layout", async () => {
    setRuntimeLocale("en");

    const text = await renderSubagentCard({
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
        filePath: "src/bot/pinned/pinned-message-manager.ts",
        offset: 1,
        limit: 280,
      },
      currentToolTitle: "Reading pinned manager",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(text).toContain("🧩 Task: task description");
    expect(text).toContain("Agent: explore");
    expect(text).toContain("Model: openai/gpt-5.4");
    expect(text).not.toContain("Context:");
    expect(text).not.toContain("Cost:");
    expect(text).toContain("📖 read src/bot/pinned/pinned-message-manager.ts");
    expect(text).not.toContain("Working:");
  });

  describe("variant on the Model line", () => {
    function buildCard(variant?: string) {
      return {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running" as const,
        providerID: "openai",
        modelID: "gpt-5.4",
        ...(variant !== undefined ? { variant } : {}),
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        cost: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    it("appends a non-empty variant in parentheses", async () => {
      const text = await renderSubagentCard(buildCard("high"));

      expect(text).toContain("Model: openai/gpt-5.4 (high)");
      expect(text).toContain("Agent: explore");
      expect(text).toContain("🧩 Task: task description");
    });

    it("keeps the Model line unchanged when variant is absent", async () => {
      const text = await renderSubagentCard(buildCard());

      expect(text).toContain("Model: openai/gpt-5.4");
      expect(text).not.toContain("(");
    });

    it("omits an empty variant", async () => {
      const text = await renderSubagentCard(buildCard(""));

      expect(text).toContain("Model: openai/gpt-5.4");
      expect(text).not.toContain("()");
    });

    it("shows a whitespace-only variant as-is", async () => {
      const text = await renderSubagentCard(buildCard(" "));

      expect(text).toContain("Model: openai/gpt-5.4 ( )");
    });

    it("shows the literal default variant", async () => {
      const text = await renderSubagentCard(buildCard("default"));

      expect(text).toContain("Model: openai/gpt-5.4 (default)");
    });
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
        createdAt: Date.now(),
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
        createdAt: Date.now(),
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
        createdAt: Date.now(),
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
        createdAt: Date.now(),
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
        createdAt: Date.now(),
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
          filePath: "src/app/formatters/subagent-formatter.ts",
        },
        currentToolTitle: "22460fc65b183e6921717bba0c84ccfcf4b57982",
        createdAt: Date.now(),
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    expect(text).toContain("🔍 grep [WARN]|[ERROR]");
    expect(text).toContain("📖 read src/app/formatters/subagent-formatter.ts");
    expect(text).toContain("📁 glob **/*.ts");
    expect(text).not.toContain("22460fc65b183e6921717bba0c84ccfcf4b57982");
  });

  describe("elapsed time on the current tool step", () => {
    const now = 1_000_000;

    function buildSubagent(currentToolStartedAt?: number) {
      return {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "running" as const,
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
        currentTool: "bash",
        currentToolInput: { command: "npm test" },
        currentToolCallId: "call-1",
        currentToolStartedAt,
        createdAt: now,
        updatedAt: now,
      };
    }

    it("appends the elapsed time once the step passed the threshold", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCards([buildSubagent(now - 45_000)], now);

      expect(text).toContain("💻 bash npm test · 🕒 40s");
    });

    it("keeps the step unchanged below the threshold", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCards([buildSubagent(now - 5_000)], now);

      expect(text).toContain("💻 bash npm test");
      expect(text).not.toContain("🕒");
    });

    it("keeps the step unchanged when the start time is unknown", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCards([buildSubagent(undefined)], now);

      expect(text).toContain("💻 bash npm test");
      expect(text).not.toContain("🕒");
    });
  });

  describe("total run time of a finished subagent", () => {
    const createdAt = 1_000_000;

    function buildFinished(finishedAt?: number) {
      return {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "explore",
        description: "task description",
        prompt: "task description",
        status: "completed" as const,
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
        createdAt,
        finishedAt,
        updatedAt: finishedAt ?? createdAt,
      };
    }

    it("reports how long the subagent ran", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCards([buildFinished(createdAt + 135_000)], createdAt);

      expect(text).toContain("✅ Completed · 🕒 2m 15s");
    });

    it("reports short runs too, without a threshold", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCards([buildFinished(createdAt + 3000)], createdAt);

      expect(text).toContain("✅ Completed · 🕒 3s");
    });

    it("freezes the duration so heartbeat re-renders do not grow it", async () => {
      setRuntimeLocale("en");
      const card = buildFinished(createdAt + 135_000);

      const first = await renderSubagentCards([card], createdAt + 135_000);
      const later = await renderSubagentCards([card], createdAt + 900_000);

      expect(later).toBe(first);
      expect(later).toContain("2m 15s");
    });

    it("falls back to the plain completed line when the finish time is unknown", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCards([buildFinished(undefined)], createdAt);

      expect(text).toContain("✅ Completed");
      expect(text).not.toContain("🕒");
    });
  });
});
