import { describe, expect, it } from "vitest";
import { extractCommandName, isKnownCommand } from "../../../src/bot/utils/commands.js";

describe("bot/utils/commands", () => {
  it("extracts command name from slash command", () => {
    expect(extractCommandName("/status")).toBe("status");
    expect(extractCommandName("/help@MyBot")).toBe("help");
    expect(extractCommandName("/model openai")).toBe("model");
  });

  it("returns null for non-command text", () => {
    expect(extractCommandName("hello")).toBeNull();
    expect(extractCommandName(" /")).toBeNull();
  });

  it("checks known commands set", () => {
    expect(isKnownCommand("status")).toBe(true);
    expect(isKnownCommand("start")).toBe(true);
    expect(isKnownCommand("foobar")).toBe(false);
  });
});
