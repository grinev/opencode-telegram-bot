import { afterEach, describe, expect, it, vi } from "#vitest";
import { isContainerRuntime, OPENCODE_TELEGRAM_CONTAINER_ENV } from "../../src/runtime/container.js";

describe("runtime/container", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false when the env flag is unset and /.dockerenv is missing", () => {
    expect(
      isContainerRuntime({
        env: {},
        dockerEnvExists: () => false,
      }),
    ).toBe(false);
  });

  it("is true when OPENCODE_TELEGRAM_CONTAINER is set to a truthy value", () => {
    expect(
      isContainerRuntime({
        env: { [OPENCODE_TELEGRAM_CONTAINER_ENV]: "1" },
        dockerEnvExists: () => false,
      }),
    ).toBe(true);
  });

  it("is false when OPENCODE_TELEGRAM_CONTAINER is 0 or false", () => {
    expect(
      isContainerRuntime({
        env: { [OPENCODE_TELEGRAM_CONTAINER_ENV]: "0" },
        dockerEnvExists: () => false,
      }),
    ).toBe(false);
    expect(
      isContainerRuntime({
        env: { [OPENCODE_TELEGRAM_CONTAINER_ENV]: "false" },
        dockerEnvExists: () => false,
      }),
    ).toBe(false);
  });

  it("is true when /.dockerenv exists even without the env flag", () => {
    expect(
      isContainerRuntime({
        env: {},
        dockerEnvExists: () => true,
      }),
    ).toBe(true);
  });

  it("reads process.env when no env override is passed", () => {
    vi.stubEnv(OPENCODE_TELEGRAM_CONTAINER_ENV, "1");

    expect(isContainerRuntime({ dockerEnvExists: () => false })).toBe(true);
  });
});
