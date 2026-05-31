import { describe, expect, it } from "vitest";
import { formatAssistantRunFooter } from "../../../src/bot/utils/assistant-run-footer.js";

describe("bot/utils/assistant-run-footer", () => {
  it("formats agent, model, and elapsed time in one line", () => {
    expect(
      formatAssistantRunFooter({
        agent: "plan",
        providerID: "openai",
        modelID: "gpt-5.4",
        elapsedMs: 57932,
      }),
    ).toBe("📋 Plan · 🤖 openai/gpt-5.4 · 🕒 57s");
  });

  it("formats duration less than 1 second as 0s", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 500,
      }),
    ).toBe("🛠️ Build · 🤖 anthropic/claude-3 · 🕒 0s");
  });

  it("formats duration with only seconds", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 45000,
      }),
    ).toBe("🛠️ Build · 🤖 anthropic/claude-3 · 🕒 45s");
  });

  it("formats duration with minutes and seconds", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 1425000,
      }),
    ).toBe("🛠️ Build · 🤖 anthropic/claude-3 · 🕒 23m 45s");
  });

  it("formats duration with hours, minutes, and seconds", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 5025000,
      }),
    ).toBe("🛠️ Build · 🤖 anthropic/claude-3 · 🕒 1h 23m 45s");
  });

  it("formats duration with hours and seconds (no minutes)", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: 3605000,
      }),
    ).toBe("🛠️ Build · 🤖 anthropic/claude-3 · 🕒 1h 5s");
  });

  it("formats negative duration as 0s", () => {
    expect(
      formatAssistantRunFooter({
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-3",
        elapsedMs: -1000,
      }),
    ).toBe("🛠️ Build · 🤖 anthropic/claude-3 · 🕒 0s");
  });
});
