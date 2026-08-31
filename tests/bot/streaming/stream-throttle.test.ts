import { afterEach, describe, expect, it } from "#vitest";
import { assistantRunState } from "../../../src/app/managers/assistant-run-state-manager.js";
import {
  STREAM_THROTTLE_BASE_MS,
  STREAM_THROTTLE_MAX_MS,
  getSessionStreamThrottleMs,
  getStreamThrottleMs,
  noteStreamActivity,
  resetAllStreamThrottles,
  resetStreamThrottle,
  resolveProgressiveThrottleMs,
  resolveStreamThrottleMs,
  __resetStreamThrottleForTests,
} from "../../../src/bot/streaming/stream-throttle.js";

const MINUTE_MS = 60_000;

describe("bot/streaming/stream-throttle", () => {
  afterEach(() => {
    __resetStreamThrottleForTests();
    assistantRunState.__resetForTests();
  });

  describe("resolveProgressiveThrottleMs", () => {
    it("stays at 1s until one minute", () => {
      expect(resolveProgressiveThrottleMs(0)).toBe(STREAM_THROTTLE_BASE_MS);
      expect(resolveProgressiveThrottleMs(MINUTE_MS - 1)).toBe(STREAM_THROTTLE_BASE_MS);
    });

    it("steps to 2s at one minute", () => {
      expect(resolveProgressiveThrottleMs(MINUTE_MS)).toBe(2_000);
      expect(resolveProgressiveThrottleMs(5 * MINUTE_MS - 1)).toBe(2_000);
    });

    it("steps to 5s at five minutes", () => {
      expect(resolveProgressiveThrottleMs(5 * MINUTE_MS)).toBe(5_000);
      expect(resolveProgressiveThrottleMs(15 * MINUTE_MS - 1)).toBe(5_000);
    });

    it("caps at 10s from fifteen minutes", () => {
      expect(resolveProgressiveThrottleMs(15 * MINUTE_MS)).toBe(STREAM_THROTTLE_MAX_MS);
      expect(resolveProgressiveThrottleMs(60 * MINUTE_MS)).toBe(STREAM_THROTTLE_MAX_MS);
    });
  });

  describe("session clock", () => {
    it("returns the base interval before any activity", () => {
      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
    });

    it("starts the clock on first activity and grows with elapsed time", () => {
      noteStreamActivity("s1", 0);

      expect(getStreamThrottleMs("s1", 0)).toBe(STREAM_THROTTLE_BASE_MS);
      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(2_000);
      expect(getStreamThrottleMs("s1", 5 * MINUTE_MS)).toBe(5_000);
      expect(getStreamThrottleMs("s1", 15 * MINUTE_MS)).toBe(STREAM_THROTTLE_MAX_MS);
    });

    it("does not restart the clock on later activity", () => {
      noteStreamActivity("s1", 0);
      noteStreamActivity("s1", MINUTE_MS);

      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(2_000);
    });

    it("notes activity when resolving the session interval", () => {
      expect(getSessionStreamThrottleMs("s1", 0)).toBe(STREAM_THROTTLE_BASE_MS);
      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(2_000);
    });

    it("resets one session without touching another", () => {
      noteStreamActivity("s1", 0);
      noteStreamActivity("s2", 0);

      resetStreamThrottle("s1");

      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
      expect(getStreamThrottleMs("s2", MINUTE_MS)).toBe(2_000);
    });

    it("resets every session clock", () => {
      noteStreamActivity("s1", 0);
      noteStreamActivity("s2", 0);

      resetAllStreamThrottles();

      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
      expect(getStreamThrottleMs("s2", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
    });
  });

  describe("resolveStreamThrottleMs", () => {
    it("accepts a number or a session function", () => {
      expect(resolveStreamThrottleMs(500, "s1")).toBe(500);
      expect(resolveStreamThrottleMs((sessionId) => (sessionId === "s1" ? 2_000 : 1_000), "s1")).toBe(
        2_000,
      );
    });
  });

  describe("run lifecycle reset", () => {
    it("resets the session clock on startRun", () => {
      noteStreamActivity("s1", 0);

      assistantRunState.startRun("s1", { startedAt: MINUTE_MS });

      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
    });

    it("resets the session clock on finishRun", () => {
      assistantRunState.startRun("s1", { startedAt: 0 });
      noteStreamActivity("s1", 0);

      assistantRunState.finishRun("s1", "test");

      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
    });

    it("resets the session clock on clearRun", () => {
      assistantRunState.startRun("s1", { startedAt: 0 });
      noteStreamActivity("s1", 0);

      assistantRunState.clearRun("s1", "test");

      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
    });

    it("resets every session clock on clearAll", () => {
      noteStreamActivity("s1", 0);
      noteStreamActivity("s2", 0);

      assistantRunState.clearAll("test");

      expect(getStreamThrottleMs("s1", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
      expect(getStreamThrottleMs("s2", MINUTE_MS)).toBe(STREAM_THROTTLE_BASE_MS);
    });
  });
});
