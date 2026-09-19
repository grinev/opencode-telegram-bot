import {
  createAppContainer,
  type AppContainer,
} from "../../src/app/bootstrap/app-container.js";

/**
 * The one place tests get a container from. It holds the same module instances
 * as production, so `tests/setup.ts` still resets its state between tests.
 * `overrides` replaces members with fakes.
 */
export function createTestAppContainer(overrides: Partial<AppContainer> = {}): AppContainer {
  return { ...createAppContainer(), ...overrides };
}
