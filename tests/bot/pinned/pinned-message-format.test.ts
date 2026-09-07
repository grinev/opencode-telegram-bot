import { describe, expect, it } from "vitest";
import { formatModelDisplayName } from "../../../src/bot/pinned/pinned-message-format.js";

describe("formatModelDisplayName", () => {
  it("appends a non-empty variant in parentheses", () => {
    expect(formatModelDisplayName("opencode-go", "deepseek-v4-flash", "low")).toBe(
      "opencode-go/deepseek-v4-flash (low)",
    );
  });

  it("shows the literal default variant", () => {
    expect(formatModelDisplayName("opencode-go", "deepseek-v4-flash", "default")).toBe(
      "opencode-go/deepseek-v4-flash (default)",
    );
  });

  it("omits parentheses when variant is absent", () => {
    expect(formatModelDisplayName("opencode-go", "deepseek-v4-flash")).toBe(
      "opencode-go/deepseek-v4-flash",
    );
  });

  it("omits an empty variant", () => {
    expect(formatModelDisplayName("opencode-go", "deepseek-v4-flash", "")).toBe(
      "opencode-go/deepseek-v4-flash",
    );
  });

  it("does not append a variant when the model is unknown", () => {
    expect(formatModelDisplayName(undefined, undefined, "low")).toBe("Unknown");
  });
});
