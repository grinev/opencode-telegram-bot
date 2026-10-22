import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBusyWindowService } from "../../../src/app/services/update-busy-window-service.js";

const NOW_MS = Date.UTC(2026, 6, 27, 12, 0, 0);

describe("update busy window service", () => {
  let service: UpdateBusyWindowService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    service = new UpdateBusyWindowService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not record a handler shorter than the cancel window", () => {
    service.record(NOW_MS, NOW_MS + 13_999);

    expect(service.covers(NOW_MS + 10_000)).toBe(false);
  });

  it("records a handler just under the cancel window to absorb the second rounding", () => {
    service.record(NOW_MS, NOW_MS + 14_000);

    expect(service.covers(NOW_MS + 10_000)).toBe(true);
  });

  it("covers a handler's first second even when it starts mid-second", () => {
    // Telegram dates a message at the start of the second the handler began in.
    const startedAt = NOW_MS + 400;
    service.record(startedAt, startedAt + 20_000);

    expect(service.covers(NOW_MS)).toBe(true);
    expect(service.covers(startedAt + 10_000)).toBe(true);
    expect(service.covers(startedAt + 20_001)).toBe(false);
  });

  it("covers messages sent while a long handler ran", () => {
    service.record(NOW_MS, NOW_MS + 90_000);

    expect(service.covers(NOW_MS + 1)).toBe(true);
    expect(service.covers(NOW_MS + 90_000)).toBe(true);
    expect(service.covers(NOW_MS - 1)).toBe(false);
    expect(service.covers(NOW_MS + 90_001)).toBe(false);
  });

  it("stops covering after the window TTL without a new long handler", () => {
    service.record(NOW_MS, NOW_MS + 90_000);

    vi.setSystemTime(NOW_MS + 2 * 60 * 60_000);

    expect(service.covers(NOW_MS + 60_000)).toBe(false);
  });

  it("forgets windows older than an hour when a new one is recorded", () => {
    service.record(NOW_MS, NOW_MS + 90_000);

    const laterStart = NOW_MS + 2 * 60 * 60_000;
    service.record(laterStart, laterStart + 90_000);

    expect(service.covers(NOW_MS + 60_000)).toBe(false);
    expect(service.covers(laterStart + 60_000)).toBe(true);
  });

  it("keeps every window within the TTL", () => {
    for (let index = 0; index < 11; index += 1) {
      const startedAt = NOW_MS + index * 2 * 60_000;
      service.record(startedAt, startedAt + 90_000);
    }

    expect(service.covers(NOW_MS + 60_000)).toBe(true);
    expect(service.covers(NOW_MS + 10 * 2 * 60_000 + 60_000)).toBe(true);
  });
});
