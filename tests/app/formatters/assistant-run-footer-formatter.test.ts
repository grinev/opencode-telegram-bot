import { afterEach, describe, expect, it } from "vitest";
import {
  assistantRunTokensPerSecond,
  formatAssistantRunFooter,
} from "../../../src/app/formatters/assistant-run-footer-formatter.js";
import { resetRuntimeLocale, setRuntimeLocale } from "../../../src/i18n/index.js";

describe("app/formatters/assistant-run-footer-formatter", () => {
  afterEach(() => {
    resetRuntimeLocale();
  });
  it("formats agent, model, and elapsed time in one line", () => {
    expect(
      formatAssistantRunFooter({
        agent: "plan",
        providerID: "openai",
        modelID: "gpt-5.4",
        elapsedMs: 57932,
      }),
    ).toBe("📋 Plan · 🧠 openai/gpt-5.4 · 🕒 57s");
  });

  it("formats duration less than 1 second as 0s", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 500,
      }),
    ).toBe("🛠️ Build · 🧠 anthropic/claude-3 · 🕒 0s");
  });

  it("formats duration with only seconds", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 45000,
      }),
    ).toBe("🛠️ Build · 🧠 anthropic/claude-3 · 🕒 45s");
  });

  it("formats duration with minutes and seconds", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 1425000,
      }),
    ).toBe("🛠️ Build · 🧠 anthropic/claude-3 · 🕒 23m 45s");
  });

  it("formats duration with hours, minutes, and seconds", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 5025000,
      }),
    ).toBe("🛠️ Build · 🧠 anthropic/claude-3 · 🕒 1h 23m 45s");
  });

  it("formats duration with hours and seconds (no minutes)", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 3605000,
      }),
    ).toBe("🛠️ Build · 🧠 anthropic/claude-3 · 🕒 1h 5s");
  });

  it("formats negative duration as 0s", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: -1000,
      }),
    ).toBe("🛠️ Build · 🧠 anthropic/claude-3 · 🕒 0s");
  });

  it("appends the speed last, with one decimal and a dot", () => {
    setRuntimeLocale("ru");

    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "openai",
        modelID: "gpt-5",
        elapsedMs: 68_000,
        steps: [
          { messageID: "a", created: 0, streamed: 500, output: 10, reasoning: 5 },
          { messageID: "b", created: 1_000, streamed: 1_500, output: 20, reasoning: 0 },
        ],
      }),
    ).toBe("🛠️ Build · 🧠 openai/gpt-5 · 🕒 1m 8s · ⚡ 35.0 tok/s");
  });

  it("drops the speed when a step has no stream time, and still names an interruption", () => {
    setRuntimeLocale("en");

    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "openai",
        modelID: "gpt-5",
        elapsedMs: 1_000,
        interrupted: true,
        steps: [{ messageID: "a", created: 0, output: 10, reasoning: 0 }],
      }),
    ).toBe("🛠️ Build · 🧠 openai/gpt-5 · 🕒 1s · ⏹ interrupted");
  });

  it("puts the marker after the speed", () => {
    setRuntimeLocale("ru");

    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "openai",
        modelID: "gpt-5",
        elapsedMs: 1_000,
        interrupted: true,
        steps: [{ messageID: "a", created: 0, streamed: 1_000, output: 42, reasoning: 0 }],
      }),
    ).toBe("🛠️ Build · 🧠 openai/gpt-5 · 🕒 1s · ⚡ 42.0 tok/s · ⏹ прерван");
  });

  it("hides a zero or unmeasurable speed", () => {
    expect(
      assistantRunTokensPerSecond([
        { messageID: "a", created: 0, streamed: 1_000, output: 0, reasoning: 0 },
      ]),
    ).toBeUndefined();
    expect(
      assistantRunTokensPerSecond([
        { messageID: "a", created: 2_000, streamed: 1_000, output: 10, reasoning: 0 },
      ]),
    ).toBeUndefined();
    expect(
      assistantRunTokensPerSecond([
        { messageID: "a", created: 2_000, streamed: 1_000, output: 0, reasoning: 0 },
        { messageID: "b", created: 0, streamed: 1_000, output: 10, reasoning: 0 },
      ]),
    ).toBe(10);
  });
});
