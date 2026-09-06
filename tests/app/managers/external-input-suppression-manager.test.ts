import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { externalUserInputSuppressionManager } from "../../../src/app/managers/external-input-suppression-manager.js";

describe("external-input/suppression", () => {
  beforeEach(() => {
    externalUserInputSuppressionManager.__resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("consumes a matching suppressed input for the same session", () => {
    externalUserInputSuppressionManager.register("session-1", "Review README");

    expect(externalUserInputSuppressionManager.consume("session-1", "Review README")).toBe(true);
    expect(externalUserInputSuppressionManager.consume("session-1", "Review README")).toBe(false);
  });

  it("does not consume a suppressed input from another session", () => {
    externalUserInputSuppressionManager.register("session-1", "Review README");

    expect(externalUserInputSuppressionManager.consume("session-2", "Review README")).toBe(false);
  });

  it("does not consume different text", () => {
    externalUserInputSuppressionManager.register("session-1", "Review README");

    expect(externalUserInputSuppressionManager.consume("session-1", "Review tests")).toBe(false);
  });

  it("expires stale suppression entries", () => {
    externalUserInputSuppressionManager.register("session-1", "Review README", 1_000);

    expect(externalUserInputSuppressionManager.consume("session-1", "Review README", 61_001)).toBe(
      false,
    );
  });

  it("retires an unobserved admitted identity after the bounded lifetime", () => {
    vi.useFakeTimers();
    externalUserInputSuppressionManager.registerMessage("session-1", "message-1");
    expect(externalUserInputSuppressionManager.__getMessageCountForTests()).toBe(1);

    vi.advanceTimersByTime(5 * 60 * 1_000);

    expect(externalUserInputSuppressionManager.__getMessageCountForTests()).toBe(0);

    expect(
      externalUserInputSuppressionManager.consumeMessage(
        "session-1",
        "message-1",
        "different rendered text",
      ),
    ).toBe(false);
  });

  it("refreshes the same stable identity when an ambiguous admission is retried", () => {
    vi.useFakeTimers();
    externalUserInputSuppressionManager.registerMessage("session-1", "message-1");
    vi.advanceTimersByTime(4 * 60 * 1_000);
    externalUserInputSuppressionManager.registerMessage("session-1", "message-1");
    vi.advanceTimersByTime(2 * 60 * 1_000);

    expect(
      externalUserInputSuppressionManager.consumeMessage("session-1", "message-1", "different"),
    ).toBe(true);
    expect(externalUserInputSuppressionManager.__getMessageCountForTests()).toBe(0);
  });

  it("does not suppress another message with the same text", () => {
    externalUserInputSuppressionManager.registerMessage("session-1", "message-1");

    expect(
      externalUserInputSuppressionManager.consumeMessage("session-1", "external-message", "same"),
    ).toBe(false);
  });

  it("does not fall back to text suppression when an identity differs", () => {
    externalUserInputSuppressionManager.register("session-1", "same text");
    externalUserInputSuppressionManager.registerMessage("session-1", "message-1");

    expect(
      externalUserInputSuppressionManager.consumeMessage(
        "session-1",
        "external-message",
        "same text",
      ),
    ).toBe(false);
  });

  it("does not suppress the same identity in another session", () => {
    externalUserInputSuppressionManager.registerMessage("session-1", "message-1");

    expect(
      externalUserInputSuppressionManager.consumeMessage("session-2", "message-1", "unrelated"),
    ).toBe(false);
    expect(
      externalUserInputSuppressionManager.consumeMessage("session-1", "message-1", "original"),
    ).toBe(true);
  });

  it("returns identity storage to baseline when a session retires", () => {
    externalUserInputSuppressionManager.registerMessage("session-1", "message-1");
    externalUserInputSuppressionManager.registerMessage("session-1", "message-2");

    externalUserInputSuppressionManager.clearSession("session-1");

    expect(externalUserInputSuppressionManager.__getMessageCountForTests()).toBe(0);
  });
});
