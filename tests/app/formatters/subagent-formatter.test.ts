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

  describe("starting card", () => {
    function buildPartial(
      fields: Partial<{
        agent: string;
        description: string;
        providerID: string;
        modelID: string;
        variant: string;
        status: "pending" | "running" | "completed" | "error";
        terminalMessage: string;
        finishedAt: number;
      }>,
    ) {
      return {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "",
        description: "",
        prompt: "",
        status: "running" as const,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        createdAt: 1_000_000,
        updatedAt: 1_000_000,
        ...fields,
      };
    }

    it("shows one starting line with the task while the model is unknown", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildPartial({ description: "task description", agent: "explore" }),
      );

      expect(text).toBe("🧩 Starting task: task description");
    });

    it("shows the starting line without a task while the task is unknown", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildPartial({ agent: "explore", providerID: "openai", modelID: "gpt-5.4" }),
      );

      expect(text).toBe("🧩 Starting task...");
    });

    it("shows the starting line while the agent is unknown", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildPartial({ description: "task description", providerID: "openai", modelID: "gpt-5.4" }),
      );

      expect(text).toBe("🧩 Starting task: task description");
    });

    it("localizes the starting line", async () => {
      setRuntimeLocale("ru");

      expect(await renderSubagentCard(buildPartial({ description: "описание" }))).toBe(
        "🧩 Запуск задачи: описание",
      );
      expect(await renderSubagentCard(buildPartial({}))).toBe("🧩 Запуск задачи...");
    });

    it("keeps a pending card starting and never prints a placeholder model", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildPartial({ description: "task description", agent: "explore", status: "pending", variant: "high" }),
      );

      expect(text).toBe("🧩 Starting task: task description");
      expect(text).not.toContain("Unknown");
    });

    it("gives a card that ended while starting its final line with the known lines", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildPartial({
          description: "task description",
          agent: "explore",
          status: "completed",
          finishedAt: 1_003_000,
        }),
      );

      expect(text).toBe("🧩 Task: task description\nAgent: explore\n\n✅ Completed · 🕒 3s");
    });

    it("starts a failed card's lines with the first known one", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildPartial({
          agent: "explore",
          providerID: "openai",
          modelID: "gpt-5.4",
          status: "error",
          terminalMessage: "Permission denied",
        }),
      );

      expect(text).toBe("🧩 Agent: explore\nModel: openai/gpt-5.4\n\n❌ Permission denied");
    });

    it("gives a card that ended knowing nothing its final line alone", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildPartial({ status: "completed", finishedAt: 1_003_000 }),
      );

      expect(text).toBe("🧩 ✅ Completed · 🕒 3s");
    });
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

  describe("a nested subagent launch", () => {
    const now = 1_000_000;

    function buildSubagent(overrides: Record<string, unknown>) {
      return {
        cardId: "card-1",
        sessionId: "child-1",
        parentSessionId: "root-1",
        agent: "general",
        description: "Delegate counting",
        prompt: "Delegate counting",
        status: "running" as const,
        providerID: "openai",
        modelID: "gpt-5.4",
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      };
    }

    it("names the task from its description, never from its prompt", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildSubagent({
          currentTool: "task",
          currentToolInput: {
            description: "Count Kotlin files",
            prompt: "Count the number of Kotlin files under src/main",
            subagent_type: "general",
          },
          currentToolStartedAt: now - 1_000,
        }),
        now,
      );

      expect(text.split("\n").at(-1)).toBe("🤖 Running Task: Count Kotlin files");
      expect(text).not.toContain("Count the number of Kotlin files");
    });

    it("shows no launch line while the launch call is still composed", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildSubagent({ currentTool: "task", currentToolInput: {}, currentToolStartedAt: now }),
        now,
      );

      expect(text.split("\n").at(-1)).toBe("⚙️ Working...");
    });

    it("times the launch line from the launch's own start", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildSubagent({
          currentTool: "task",
          currentToolInput: { prompt: "Count" },
          currentToolStartedAt: now - 45_000,
        }),
        now,
      );

      expect(text.split("\n").at(-1)).toBe("🤖 Running Task · 🕒 40s");
    });

    it("falls back to a launch still running when nothing newer is on the line", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildSubagent({ launchStartedAt: now - 25_000, launchDescription: "Count Kotlin files" }),
        now,
      );

      expect(text.split("\n").at(-1)).toBe("🤖 Running Task: Count Kotlin files · 🕒 20s");
    });

    it("falls back to the bare launch line when the launch's task is not known", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(buildSubagent({ launchStartedAt: now - 25_000 }), now);

      expect(text.split("\n").at(-1)).toBe("🤖 Running Task · 🕒 20s");
    });

    it("keeps a newer tool on the line over a launch still running", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildSubagent({
          currentTool: "bash",
          currentToolInput: { command: "npm test" },
          currentToolStartedAt: now,
          launchStartedAt: now - 25_000,
        }),
        now,
      );

      expect(text.split("\n").at(-1)).toBe("💻 bash npm test");
    });

    it("shows a long execute step as its cut code, not its title", async () => {
      setRuntimeLocale("en");

      const text = await renderSubagentCard(
        buildSubagent({
          currentTool: "execute",
          currentToolInput: { code: `return 1;\n${"c".repeat(200)}` },
          currentToolTitle: "Run code",
          currentToolStartedAt: now,
        }),
        now,
      );

      const line = text.split("\n").at(-1);
      expect(line).toMatch(/^🛠️ execute return 1; c+\.\.\.$/);
      expect(line).toHaveLength(128);
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

    describe("an interrupted subagent", () => {
      function buildInterrupted(finishedAt: number) {
        return { ...buildFinished(finishedAt), status: "interrupted" as const };
      }

      it("ends with the interrupted line and how long it ran, in place of the activity", async () => {
        setRuntimeLocale("en");

        const text = await renderSubagentCards([buildInterrupted(createdAt + 5000)], createdAt);

        expect(text.split("\n").at(-1)).toBe("⏹ Interrupted · 🕒 5s");
        expect(text).toContain("Task: task description");
        expect(text).not.toContain("✅");
        expect(text).not.toContain("❌");
      });

      it("keeps the duration frozen on later re-renders", async () => {
        setRuntimeLocale("en");
        const card = buildInterrupted(createdAt + 5000);

        const later = await renderSubagentCards([card], createdAt + 900_000);

        expect(later).toContain("⏹ Interrupted · 🕒 5s");
      });

      it("localizes the interrupted line", async () => {
        setRuntimeLocale("ru");

        const text = await renderSubagentCards([buildInterrupted(createdAt + 5000)], createdAt);

        expect(text).toContain("⏹ Прервана · 🕒 5s");
      });

      it("gives a card interrupted while starting its final line with the known lines", async () => {
        setRuntimeLocale("en");
        const card = { ...buildInterrupted(createdAt + 5000), providerID: undefined };

        const text = await renderSubagentCards([card], createdAt);

        expect(text).not.toContain("Starting task");
        expect(text).toContain("Task: task description");
        expect(text).not.toContain("Model:");
        expect(text).toContain("⏹ Interrupted · 🕒 5s");
      });
    });
  });
});
