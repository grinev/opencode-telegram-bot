import { beforeEach, describe, expect, it } from "vitest";
import { externalUserInputSuppressionManager } from "../../src/external-input/suppression.js";

describe("external-input/suppression", () => {
  beforeEach(() => {
    externalUserInputSuppressionManager.__resetForTests();
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
});
