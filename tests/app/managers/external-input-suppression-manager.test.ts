import { beforeEach, describe, expect, it } from "vitest";
import { ExternalUserInputSuppressionManager } from "../../../src/app/managers/external-input-suppression-manager.js";

let externalUserInputSuppressionManager: ExternalUserInputSuppressionManager;

beforeEach(() => {
  externalUserInputSuppressionManager = new ExternalUserInputSuppressionManager();
});

describe("external-input/suppression", () => {
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
});
