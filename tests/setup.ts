import { beforeEach, afterEach, vi } from "vitest";
import { ensureTestEnvironment } from "./helpers/test-environment.js";
import { resetSingletonState } from "./helpers/reset-singleton-state.js";

vi.mock("../src/runtime/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/runtime/paths.js")>();
  const { isolateRuntimePaths } = await import("./helpers/test-environment.js");
  return { ...actual, getRuntimePaths: () => isolateRuntimePaths(actual.getRuntimePaths()) };
});

ensureTestEnvironment();

beforeEach(() => {
  ensureTestEnvironment();
  return resetSingletonState();
});

afterEach(async () => {
  await resetSingletonState();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  ensureTestEnvironment();
});
