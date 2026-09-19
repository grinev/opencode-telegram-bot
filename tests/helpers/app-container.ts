import {
  createAppContainer,
  type AppContainer,
} from "../../src/app/bootstrap/app-container.js";

/**
 * The one place tests get a container from. Every call builds fresh managers,
 * so state never leaks between containers. `overrides` replaces members with
 * fakes; it does not rewire the managers the container built on the real ones.
 */
export function createTestAppContainer(overrides: Partial<AppContainer> = {}): AppContainer {
  return { ...createAppContainer(), ...overrides };
}
