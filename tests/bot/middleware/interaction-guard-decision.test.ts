import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { resolveInteractionGuardDecision } from "../../../src/bot/middleware/interaction-guard-decision.js";
import { interactionManager } from "../../../src/app/managers/interaction-manager.js";
import { foregroundSessionState } from "../../../src/app/managers/foreground-session-state-manager.js";

function createContext({
  text,
  callbackData,
  voice,
  audio,
  photo,
}: {
  text?: string;
  callbackData?: string;
  voice?: boolean;
  audio?: boolean;
  photo?: boolean;
}): Context {
  const message: Record<string, unknown> = {};

  if (text !== undefined) {
    message.text = text;
  }

  if (voice) {
    message.voice = { file_id: "voice-file-id" };
  }

  if (audio) {
    message.audio = { file_id: "audio-file-id" };
  }

  if (photo) {
    message.photo = [
      { file_id: "photo-file-id", file_unique_id: "unique-photo-id", width: 1280, height: 720 },
    ];
  }

  return {
    message:
      Object.keys(message).length > 0 ? (message as unknown as Context["message"]) : undefined,
    callbackQuery:
      callbackData !== undefined ? ({ data: callbackData } as Context["callbackQuery"]) : undefined,
  } as Context;
}

describe("interaction guard", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    foregroundSessionState.__resetForTests();
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

  it("always allows /start even when command list is restricted", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/status"],
    });

    const decision = resolveInteractionGuardDecision(createContext({ text: "/start" }));

    expect(decision.allow).toBe(true);
    expect(decision.command).toBe("/start");
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

  it("allows voice input when there is no active interaction", () => {
    const decision = resolveInteractionGuardDecision(createContext({ voice: true }));

    expect(decision.allow).toBe(true);
    expect(decision.state).toBeNull();
    expect(decision.inputType).toBe("other");
  });

  it("blocks voice input when text input is expected", () => {
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
    });

    const decision = resolveInteractionGuardDecision(createContext({ voice: true }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_text");
    expect(decision.inputType).toBe("other");
  });

  it("blocks audio input when mixed input is expected", () => {
    interactionManager.start({
      kind: "question",
      expectedInput: "mixed",
    });

    const decision = resolveInteractionGuardDecision(createContext({ audio: true }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_text");
    expect(decision.inputType).toBe("other");
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

  it("blocks photo input when text input is expected (rename)", () => {
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
    });

    const decision = resolveInteractionGuardDecision(createContext({ photo: true }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_text");
    expect(decision.inputType).toBe("other");
    expect(decision.state?.kind).toBe("rename");
  });

  it("blocks photo input when mixed input is expected (question)", () => {
    interactionManager.start({
      kind: "question",
      expectedInput: "mixed",
    });

    const decision = resolveInteractionGuardDecision(createContext({ photo: true }));

    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("expected_text");
    expect(decision.inputType).toBe("other");
    expect(decision.state?.kind).toBe("question");
  });

  it("allows photo input when there is no active interaction", () => {
    const decision = resolveInteractionGuardDecision(createContext({ photo: true }));

    expect(decision.allow).toBe(true);
    expect(decision.state).toBeNull();
    expect(decision.inputType).toBe("other");
  });

  it("allows only abort, detach, status, and help commands while busy without interaction", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    expect(resolveInteractionGuardDecision(createContext({ text: "/abort" })).allow).toBe(true);
    expect(resolveInteractionGuardDecision(createContext({ text: "/detach" })).allow).toBe(true);
    expect(resolveInteractionGuardDecision(createContext({ text: "/status" })).allow).toBe(true);
    expect(resolveInteractionGuardDecision(createContext({ text: "/help" })).allow).toBe(true);

    const blockedDecision = resolveInteractionGuardDecision(createContext({ text: "/new" }));
    expect(blockedDecision.allow).toBe(false);
    expect(blockedDecision.reason).toBe("command_not_allowed");
    expect(blockedDecision.busy).toBe(true);
  });

  it("blocks disallowed commands while busy without interaction", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const startDecision = resolveInteractionGuardDecision(createContext({ text: "/start" }));

    expect(startDecision.allow).toBe(false);
    expect(startDecision.reason).toBe("command_not_allowed");
  });

  it("lets plain text and media through while busy so they can be queued", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const textDecision = resolveInteractionGuardDecision(createContext({ text: "hello" }));
    const voiceDecision = resolveInteractionGuardDecision(createContext({ voice: true }));
    const photoDecision = resolveInteractionGuardDecision(createContext({ photo: true }));

    expect(textDecision.allow).toBe(true);
    expect(textDecision.busy).toBe(true);
    expect(voiceDecision.allow).toBe(true);
    expect(photoDecision.allow).toBe(true);
  });

  it("allows the queued-prompt cancel button while busy", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const decision = resolveInteractionGuardDecision(createContext({ callbackData: "qcancel:3" }));

    expect(decision.allow).toBe(true);
  });

  it("allows the queued-prompt cancel button while another interaction is pending", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
    });

    const decision = resolveInteractionGuardDecision(createContext({ callbackData: "qcancel:3" }));

    expect(decision.allow).toBe(true);
  });

  it("keeps blocking reply-keyboard buttons while busy instead of queueing them", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");

    const agentDecision = resolveInteractionGuardDecision(
      createContext({ text: "🤖 build Agent" }),
    );
    const modelDecision = resolveInteractionGuardDecision(createContext({ text: "🧠 gpt-5.5" }));
    const variantDecision = resolveInteractionGuardDecision(createContext({ text: "💡 default" }));
    const contextDecision = resolveInteractionGuardDecision(createContext({ text: "📊 12%" }));

    expect(agentDecision.allow).toBe(false);
    expect(modelDecision.allow).toBe(false);
    expect(variantDecision.allow).toBe(false);
    expect(contextDecision.allow).toBe(false);
  });

  it("still blocks plain text while busy when an interaction owns the next message", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
    });

    const textDecision = resolveInteractionGuardDecision(createContext({ text: "hello" }));

    expect(textDecision.allow).toBe(false);
    expect(textDecision.reason).toBe("expected_text");
  });

  it("allows valid question answers while busy", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    interactionManager.start({
      kind: "question",
      expectedInput: "mixed",
    });

    const callbackDecision = resolveInteractionGuardDecision(
      createContext({ callbackData: "question:select:0:1" }),
    );
    const textDecision = resolveInteractionGuardDecision(createContext({ text: "custom answer" }));
    const commandDecision = resolveInteractionGuardDecision(createContext({ text: "/status" }));
    const detachDecision = resolveInteractionGuardDecision(createContext({ text: "/detach" }));
    const blockedCommand = resolveInteractionGuardDecision(createContext({ text: "/new" }));

    expect(callbackDecision.allow).toBe(true);
    expect(callbackDecision.busy).toBe(true);
    expect(textDecision.allow).toBe(true);
    expect(textDecision.busy).toBe(true);
    expect(commandDecision.allow).toBe(true);
    expect(detachDecision.allow).toBe(true);
    expect(blockedCommand.allow).toBe(false);
    expect(blockedCommand.reason).toBe("command_not_allowed");
  });

  it("allows valid permission callback while busy and blocks other inputs", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    interactionManager.start({
      kind: "permission",
      expectedInput: "callback",
    });

    const callbackDecision = resolveInteractionGuardDecision(
      createContext({ callbackData: "permission:allow:123" }),
    );
    const textDecision = resolveInteractionGuardDecision(createContext({ text: "hello" }));

    expect(callbackDecision.allow).toBe(true);
    expect(callbackDecision.busy).toBe(true);
    expect(textDecision.allow).toBe(false);
    expect(textDecision.reason).toBe("expected_callback");
    expect(textDecision.busy).toBe(true);
  });

  it("does not allow rename callback to bypass busy state", () => {
    foregroundSessionState.markBusy("session-1", "D:\\Projects\\Repo");
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
    });

    const decision = resolveInteractionGuardDecision(
      createContext({ callbackData: "rename:cancel" }),
    );

    expect(decision.allow).toBe(false);
    expect(decision.busy).toBe(true);
  });
});
