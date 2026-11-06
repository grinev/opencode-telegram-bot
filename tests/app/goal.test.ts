import { describe, expect, it } from "vitest";
import { GoalManager } from "../../src/app/managers/goal-manager.js";
import {
  formatAbortWithGoalPause,
  formatDashboardGoalLine,
  formatGoalConfirmation,
  formatGoalStatusText,
  localizeGoalReason,
  truncateGoalObjective,
} from "../../src/app/formatters/goal-text.js";
import { parseGoalObjective, GOAL_OBJECTIVE_LIMIT } from "../../src/app/types/goal.js";
import {
  getGoalButtonLabels,
  resolveGoalButton,
  GOAL_BUTTON_TEXT_PATTERN,
} from "../../src/bot/keyboards/goal-button.js";
import { isReplyKeyboardButtonText } from "../../src/bot/message-patterns.js";
import type { GoalState } from "../../src/app/types/goal.js";
import { isGoalInternalMetadata } from "../../src/opencode/v2/goal-message.js";

const goal: GoalState = {
  id: "g1",
  objective: "Rename the module",
  status: "active",
  rounds: 2,
  maxRounds: 50,
  updatedAt: Date.parse("2026-11-04T12:00:00Z"),
  reason: "Paused by the user",
};

describe("goal objective", () => {
  it("rejects empty and reserved controls without executing them", () => {
    expect(parseGoalObjective("  ")).toEqual({ kind: "empty" });
    for (const value of [
      "PAUSE",
      "Resume",
      "clear",
      ' "PAUSE" ',
      "‘clear’",
      "“resume”",
      "'pause'",
    ]) {
      expect(parseGoalObjective(value)).toEqual({ kind: "reserved" });
    }
    expect(parseGoalObjective("pause now")).toEqual({ kind: "objective", text: "pause now" });
    expect(parseGoalObjective("\"pause'")).toEqual({ kind: "objective", text: "\"pause'" });
    expect(parseGoalObjective('" "')).toEqual({ kind: "empty" });
  });

  it("rejects an objective past the server limit without treating it as a control", () => {
    const text = "x".repeat(GOAL_OBJECTIVE_LIMIT + 1);
    expect(parseGoalObjective(text)).toEqual({ kind: "too_long", length: text.length });
  });
});

describe("goal text", () => {
  it("keeps a short objective and cuts a long one to 119 characters plus an ellipsis", () => {
    expect(truncateGoalObjective("one   line")).toBe("one line");
    const long = "word ".repeat(40);
    const cut = truncateGoalObjective(long);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(120);
  });

  it("omits the dashboard line when there is no goal", () => {
    expect(formatDashboardGoalLine(null)).toBeNull();
    expect(formatDashboardGoalLine(goal)).toContain("Rename the module");
  });

  it("includes rounds, maxRounds, reason and an update time in the status", () => {
    const text = formatGoalStatusText(goal);
    expect(text).toContain("Rename the module");
    expect(text).toContain("2/50");
    expect(text).toContain(localizeGoalReason("Paused by the user"));
    expect(text).toMatch(/\d/);
  });

  it("localizes a fixed reason and keeps a free-form tail", () => {
    expect(localizeGoalReason("Reached the limit of 50 rounds")).toContain("50");
    expect(localizeGoalReason("Not making progress: the tests still fail")).toContain(
      "the tests still fail",
    );
    expect(localizeGoalReason("the judge said something new")).toBe("the judge said something new");
  });

  it("keeps the warning when the confirmation does not fit", () => {
    const text = formatGoalConfirmation({
      action: "start",
      objective: "n".repeat(4000),
    });
    expect(text.length).toBeLessThanOrEqual(3800);
    expect(text).toContain("tokens");
    expect(text.endsWith("…")).toBe(true);
  });

  it("leaves the abort text unchanged when there was nothing to pause", () => {
    expect(formatAbortWithGoalPause("Stopped.", { kind: "silent" })).toBe("Stopped.");
    expect(formatAbortWithGoalPause("Stopped.", { kind: "paused", reason: "Paused" })).toContain(
      "Stopped.",
    );
    expect(
      formatAbortWithGoalPause("Stopped.", { kind: "failed", reason: "network" }),
    ).not.toContain("Goal paused");
  });
});

describe("goal manager", () => {
  it("announces a pause once and does not treat a clear as completion", () => {
    const manager = new GoalManager();
    manager.follow("ses");
    const paused = { ...goal, status: "paused" as const };
    expect(manager.apply("ses", paused, true)?.status).toBe("paused");
    expect(manager.apply("ses", paused, true)).toBeNull();
    expect(manager.apply("other", paused, true)).toBeNull();
    expect(manager.apply("ses", null, true)).toBeNull();
    expect(manager.snapshot().goal).toBeNull();
  });

  it("does not replay a pause found by a quiet refresh", () => {
    const manager = new GoalManager();
    manager.follow("ses");
    const paused = { ...goal, status: "paused" as const };
    expect(manager.apply("ses", paused, false)).toBeNull();
    expect(manager.apply("ses", paused, true)).toBeNull();
  });

  it("swallows a pause notice the caller is composing", () => {
    const manager = new GoalManager();
    manager.follow("ses");
    manager.suppressPauseNotice();
    expect(manager.apply("ses", { ...goal, status: "paused" }, true)).toBeNull();
  });

  it("keeps internal bindings without displaying them and resolves plain controls against the current state", () => {
    const manager = new GoalManager();
    manager.follow("ses");
    manager.apply("ses", goal, false);
    const labels = getGoalButtonLabels(manager);
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(GOAL_BUTTON_TEXT_PATTERN.test(label)).toBe(true);
      expect(isReplyKeyboardButtonText(label)).toBe(true);
    }
    expect(resolveGoalButton(manager, labels[1]!)).toBe("pause");
    const token = manager.getControlToken();
    expect(labels.every((label) => !label.includes(token))).toBe(true);
    expect(labels[1]).toBe("⏸ Pause");
    manager.apply("ses", { ...goal, rounds: 3, updatedAt: goal.updatedAt + 1 }, false);
    expect(manager.getControlToken()).toBe(token);
    expect(manager.claimControl(token)).toBe(true);
    expect(manager.claimControl(token)).toBe(false);
    expect(resolveGoalButton(manager, labels[1]!)).toBe("pause");
    expect(getGoalButtonLabels(manager)).toEqual(labels);
    manager.apply("ses", { ...goal, status: "paused" }, false);
    expect(resolveGoalButton(manager, labels[1]!)).toBeNull();
    expect(resolveGoalButton(manager, getGoalButtonLabels(manager)[1]!)).toBe("resume");
    manager.apply("ses", { ...goal, status: "complete" }, false);
    expect(resolveGoalButton(manager, getGoalButtonLabels(manager)[1]!)).toBe("clear");
  });

  it("clears the followed binding and ignores a late result after detach", () => {
    const manager = new GoalManager();
    manager.follow("ses");
    manager.apply("ses", goal, false);
    const labels = getGoalButtonLabels(manager);
    manager.clear();
    manager.apply("ses", goal, true);
    expect(manager.snapshot()).toEqual({ sessionId: null, goal: null });
    expect(getGoalButtonLabels(manager)).toEqual([]);
    expect(resolveGoalButton(manager, labels[0]!)).toBeNull();
  });
});

describe("goal message metadata", () => {
  it("matches only a goal source", () => {
    expect(isGoalInternalMetadata({ source: "goal" })).toBe(true);
    expect(isGoalInternalMetadata({ source: "user" })).toBe(false);
    expect(isGoalInternalMetadata(undefined)).toBe(false);
  });
});
