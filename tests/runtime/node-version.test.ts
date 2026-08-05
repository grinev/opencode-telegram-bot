import { describe, expect, it } from "vitest";
import { getUnsupportedNodeVersionMessage } from "../../src/runtime/node-version.js";

describe("getUnsupportedNodeVersionMessage", () => {
  it("rejects Node.js versions below 22", () => {
    const message = getUnsupportedNodeVersionMessage("20.20.1");

    expect(message).toContain("requires Node.js 22.14 or newer");
    expect(message).toContain("v20.20.1");
  });

  it("rejects Node.js 22 minors without Node-API v10", () => {
    const message = getUnsupportedNodeVersionMessage("22.12.0");

    expect(message).toContain("requires Node.js 22.14 or newer");
    expect(message).toContain("v22.12.0");
  });

  it("accepts the minimum supported version", () => {
    expect(getUnsupportedNodeVersionMessage("22.14.0")).toBeNull();
  });

  it("accepts newer major versions", () => {
    expect(getUnsupportedNodeVersionMessage("24.3.0")).toBeNull();
  });

  it("does not block startup when the version cannot be parsed", () => {
    expect(getUnsupportedNodeVersionMessage("unknown")).toBeNull();
  });

  it("accepts the version the tests are running on", () => {
    expect(getUnsupportedNodeVersionMessage()).toBeNull();
  });
});
