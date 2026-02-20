import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { resolveInteractionGuardDecision } from "../../src/interaction/guard.js";
import { interactionManager } from "../../src/interaction/manager.js";

function createContext({ text, callbackData }: { text?: string; callbackData?: string }): Context {
  return {
    message: text !== undefined ? ({ text } as Context["message"]) : undefined,
    callbackQuery:
      callbackData !== undefined ? ({ data: callbackData } as Context["callbackQuery"]) : undefined,
  } as Context;
}

describe("interaction guard", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
  });

  it("allows input when there is no active interaction", () => {
    const decision = resolveInteractionGuardDecision(createContext({ text: "hello" }));

    expect(decision.allow).toBe(true);
    expect(decision.state).toBeNull();
  });

  it("blocks text when callback input is expected", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
    });

    const decision = resolveInteractionGuardDecision(createContext({ text: "hello" }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_callback");
    expect(decision.inputType).toBe("text");
  });

  it("allows callback when callback input is expected", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
    });

    const decision = resolveInteractionGuardDecision(
      createContext({ callbackData: "model:foo:bar" }),
    );

    expect(decision.allow).toBe(true);
    expect(decision.inputType).toBe("callback");
  });

  it("allows command from allowed commands list", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const decision = resolveInteractionGuardDecision(createContext({ text: "/status" }));

    expect(decision.allow).toBe(true);
    expect(decision.command).toBe("/status");
  });

  it("blocks command that is not allowed", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const decision = resolveInteractionGuardDecision(createContext({ text: "/help" }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("command_not_allowed");
    expect(decision.command).toBe("/help");
  });

  it("clears state and blocks when interaction is expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    interactionManager.start({
      kind: "permission",
      expectedInput: "callback",
      expiresInMs: 1000,
    });

    vi.advanceTimersByTime(1001);

    const decision = resolveInteractionGuardDecision(createContext({ text: "hello" }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expired");
    expect(interactionManager.isActive()).toBe(false);
  });

  it("allows mixed input for non-command events", () => {
    interactionManager.start({
      kind: "question",
      expectedInput: "mixed",
    });

    const decisionText = resolveInteractionGuardDecision(createContext({ text: "custom answer" }));
    const decisionCallback = resolveInteractionGuardDecision(
      createContext({ callbackData: "question:select:0:1" }),
    );

    expect(decisionText.allow).toBe(true);
    expect(decisionCallback.allow).toBe(true);
  });

  it("blocks text while permission interaction is active", () => {
    interactionManager.start({
      kind: "permission",
      expectedInput: "callback",
    });

    const decision = resolveInteractionGuardDecision(createContext({ text: "some text" }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_callback");
    expect(decision.state?.kind).toBe("permission");
  });

  it("allows default status command while permission interaction is active", () => {
    interactionManager.start({
      kind: "permission",
      expectedInput: "callback",
    });

    const decision = resolveInteractionGuardDecision(createContext({ text: "/status" }));

    expect(decision.allow).toBe(true);
    expect(decision.command).toBe("/status");
    expect(decision.state?.kind).toBe("permission");
  });

  it("blocks disallowed command while question mixed interaction is active", () => {
    interactionManager.start({
      kind: "question",
      expectedInput: "mixed",
      allowedCommands: ["/status"],
    });

    const decision = resolveInteractionGuardDecision(createContext({ text: "/new" }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("command_not_allowed");
    expect(decision.state?.kind).toBe("question");
  });

  it("allows rename cancel callback when rename expects text", () => {
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
    });

    const decision = resolveInteractionGuardDecision(
      createContext({ callbackData: "rename:cancel" }),
    );

    expect(decision.allow).toBe(true);
    expect(decision.inputType).toBe("callback");
    expect(decision.state?.kind).toBe("rename");
  });

  it("blocks non-rename callback while rename expects text", () => {
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
    });

    const decision = resolveInteractionGuardDecision(
      createContext({ callbackData: "project:abc" }),
    );

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_text");
    expect(decision.state?.kind).toBe("rename");
  });
});
