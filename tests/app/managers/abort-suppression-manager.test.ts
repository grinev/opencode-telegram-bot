import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __getUserAbortErrorSuppressionSizeForTests,
  __resetUserAbortErrorSuppressionForTests,
  markUserAbortRequested,
  shouldSuppressUserAbortSessionError,
} from "../../../src/app/managers/abort-suppression-manager.js";

describe("app/managers/abort-suppression-manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T10:00:00Z"));
    __resetUserAbortErrorSuppressionForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetUserAbortErrorSuppressionForTests();
  });

  it("suppresses one Aborted error after a user abort request", () => {
    markUserAbortRequested("session-1");

    expect(shouldSuppressUserAbortSessionError("session-1", " Aborted ")).toBe(true);
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(false);
  });

  it("does not suppress unrelated errors after a user abort request", () => {
    markUserAbortRequested("session-1");

    expect(shouldSuppressUserAbortSessionError("session-1", "Model not found")).toBe(false);
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(true);
  });

  it("does not suppress stale abort errors", () => {
    markUserAbortRequested("session-1");
    vi.advanceTimersByTime(90_001);

    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(false);
  });

  it("keeps abort markers active within the suppression window", () => {
    markUserAbortRequested("session-1");
    vi.advanceTimersByTime(89_999);

    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(true);
  });

  it("removes expired markers when a new abort request is marked", () => {
    markUserAbortRequested("session-1");
    vi.advanceTimersByTime(90_001);

    markUserAbortRequested("session-2");

    expect(__getUserAbortErrorSuppressionSizeForTests()).toBe(1);
    expect(shouldSuppressUserAbortSessionError("session-1", "Aborted")).toBe(false);
    expect(shouldSuppressUserAbortSessionError("session-2", "Aborted")).toBe(true);
  });
});
