import { describe, expect, it } from "vitest";
import { resolveHealthPort } from "../../src/runtime/health-port.js";

describe("runtime/health-port", () => {
  it("is off when unset outside a container and 3100 inside", () => {
    expect(resolveHealthPort(undefined, false)).toBe(0);
    expect(resolveHealthPort(undefined, true)).toBe(3100);
  });

  it("treats an empty or blank value as unset", () => {
    expect(resolveHealthPort("", false)).toBe(0);
    expect(resolveHealthPort("   ", true)).toBe(3100);
  });

  it("keeps 0 as disabled in and out of a container", () => {
    expect(resolveHealthPort("0", false)).toBe(0);
    expect(resolveHealthPort("0", true)).toBe(0);
  });

  it("uses a valid port, trimming whitespace", () => {
    expect(resolveHealthPort("3200", false)).toBe(3200);
    expect(resolveHealthPort(" 65535 ", true)).toBe(65535);
  });

  it.each(["65536", "70000", "-1", "abc", "3100.5", "31a0", "1e3"])(
    "treats %s as unset",
    (value) => {
      expect(resolveHealthPort(value, false)).toBe(0);
      expect(resolveHealthPort(value, true)).toBe(3100);
    },
  );
});
