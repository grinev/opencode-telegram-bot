import * as bunTest from "bun:test";

const stubbedEnvs = new Map<string, string | undefined>();
const stubbedGlobals = new Map<string, unknown>();
const originalGlobalDescriptors = new Map<string, PropertyDescriptor | undefined>();
const trackedMocks: { mockRestore(): void; mockClear?(): void }[] = [];

/** Reference to the real setTimeout, captured at module load, so vi.waitFor
 *  always uses a real timer for polling even when fake timers are active.
 *
 *  Also captures Date.now so waitFor can measure real elapsed time — with
 *  vi.useFakeTimers() the mock Date.now would never advance, causing an
 *  infinite loop. */
const _shimRealSetTimeout = globalThis.setTimeout;
const _shimRealDateNow = Date.now.bind(Date);

function captureOriginalGlobal(key: string): void {
  if (originalGlobalDescriptors.has(key)) return;
  originalGlobalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
}

function setGlobal(key: string, value: unknown): void {
  captureOriginalGlobal(key);
  // Use Object.defineProperty to bypass readonly checks (e.g. bun's
  // `Bun` global is non-writable in strict mode).
  try {
    (globalThis as Record<string, unknown>)[key] = value;
  } catch {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

function restoreGlobal(key: string): void {
  const descriptor = originalGlobalDescriptors.get(key);
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    delete (globalThis as Record<string, unknown>)[key];
  }
  originalGlobalDescriptors.delete(key);
}

export function stubEnv(key: string, value: string | undefined): void {
  if (!stubbedEnvs.has(key)) {
    stubbedEnvs.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

export function stubGlobal<T>(key: string, value: T): void {
  if (!stubbedGlobals.has(key)) {
    stubbedGlobals.set(key, (globalThis as Record<string, unknown>)[key]);
  }
  setGlobal(key, value as unknown);
}

export function unstubAllEnvs(): void {
  for (const [key, previous] of stubbedEnvs) {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  stubbedEnvs.clear();
}

export function unstubAllGlobals(): void {
  for (const key of stubbedGlobals.keys()) {
    restoreGlobal(key);
  }
  stubbedGlobals.clear();
}

type AnyMock = ((...args: unknown[]) => unknown) & {
  mock: { calls: unknown[][]; results: unknown[] };
  mockImplementation: (impl: (...args: unknown[]) => unknown) => AnyMock;
  mockReturnValue: (value: unknown) => AnyMock;
  mockResolvedValue: (value: unknown) => AnyMock;
  mockRejectedValue: (value: unknown) => AnyMock;
  mockClear: () => AnyMock;
  mockReset: () => AnyMock;
  mockRestore: () => AnyMock;
};

type RestorableMock = { mockRestore: () => void; mockClear?: () => void };

function attachRestore(target: unknown, restore: () => void): RestorableMock {
  const wrapper: RestorableMock = {
    mockRestore: restore,
    mockClear: () => {
      const t = target as { mockClear?: () => void };
      t.mockClear?.();
    },
  };
  trackedMocks.push(wrapper);
  return wrapper;
}

export function fn<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  implementation?: (...args: TArgs) => TReturn,
): AnyMock {
  const initialImpl = implementation ?? (() => undefined);
  const bunMock = bunTest.mock(initialImpl as (...args: unknown[]) => unknown);
  const wrapped = bunMock as unknown as AnyMock;
  // bun's mock.mockRestore() resets the implementation to a no-op instead
  // of restoring the original. We override restore to call mockReset() (keeps
  // implementation, clears call tracking) + re-apply the initial impl explicitly.
  attachRestore(wrapped, () => {
    bunMock.mockReset();
    bunMock.mockImplementation(initialImpl as (...args: unknown[]) => unknown);
  });
  return wrapped;
}

export function spyOn<T extends object, M extends PropertyKey>(
  obj: T,
  method: M,
): AnyMock {
  const bunSpy = bunTest.spyOn(obj as Record<string | symbol, unknown>, method as string);
  const wrapped = bunSpy as unknown as AnyMock;
  attachRestore(wrapped, () => {
    bunSpy.mockRestore();
  });
  return wrapped;
}

export function restoreAllMocks(): void {
  // Restore every tracked mock WITHOUT dropping them from the registry.
  // Vitest's restoreAllMocks() restores all existing mocks and keeps
  // tracking them; popping here emptied the registry after the first
  // test, so later vi.clearAllMocks() calls (which tests rely on for
  // isolation) had nothing to clear and call counts leaked between tests.
  for (const m of trackedMocks) {
    try {
      m.mockRestore();
    } catch {
      // ignore — restore best-effort
    }
  }
}

export function clearAllMocks(): void {
  for (const m of trackedMocks) {
    try {
      m.mockClear?.();
    } catch {
      // ignore
    }
  }
}

function resolveModuleSpecifier(path: string): string {
  if (path.startsWith(".") || path.startsWith("/") || path.startsWith("node:")) {
    return path;
  }
  return path;
}

export function mock(path: string, factory: unknown): void {
  if (typeof factory === "function") {
    const fn = factory as (...args: unknown[]) => unknown;
    if (fn.length >= 1) {
      // importOriginal must resolve the REAL module, bypassing the mock.
      // bun's mock.module intercepts dynamic imports of the same path,
      // so we resolve the absolute file path (not the alias) and import
      // that directly. Bun won't match the abs path against mock.module
      // because the mock was registered with the alias/relative path.
      const importOriginal = <T = unknown>(): Promise<T> => {
        const specifier = resolveModuleSpecifier(path);
        const absPath = specifier.startsWith("#")
          ? new URL(specifier.slice(1), `file://${process.cwd()}/`).pathname
          : specifier;
        if (process.env.DEBUG_TEST) console.log(`[importOriginal] ${specifier} -> ${absPath}`);
        return import(absPath) as Promise<T>;
      };
      const adapted: () => unknown = () => (factory as (io: typeof importOriginal) => unknown)(importOriginal);
      bunTest.mock.module(resolveModuleSpecifier(path), adapted as () => Record<string, unknown>);
      return;
    }
    bunTest.mock.module(resolveModuleSpecifier(path), factory as () => Record<string, unknown>);
    return;
  }
  bunTest.mock.module(resolveModuleSpecifier(path), factory as () => Record<string, unknown>);
}

export function doMock(path: string, factory: () => unknown): void {
  bunTest.mock.module(resolveModuleSpecifier(path), factory as () => Record<string, unknown>);
}

export function doUnmock(path: string): void {
  bunTest.mock.module(resolveModuleSpecifier(path), () => import(path));
}

export function hoisted<T>(factory: () => T): T {
  return factory();
}

export function useFakeTimers(_options?: unknown): void {
  bunTest.jest.useFakeTimers();
}

export function useRealTimers(): void {
  bunTest.jest.useRealTimers();
}

export function advanceTimersByTime(ms: number): void {
  // bun >= 1.4.0 advances the fake clock accumulatively from wherever it
  // currently is (verified: setSystemTime(base) + advance(1000) x2 lands on
  // base+2000, not realNow+2000). The old workaround — snapshot the clock,
  // advance, then re-anchor with setSystemTime(before+ms) — is gone because
  // re-anchoring can interfere with pending fake timers' deadlines.
  bunTest.jest.advanceTimersByTime(ms);
}

export async function advanceTimersByTimeAsync(ms: number): Promise<void> {
  // vitest's async variant advances the clock in a loop, letting the microtask
  // chains that timer callbacks spawn register their OWN timers before the
  // clock moves on. A single synchronous advance (what bun's jest API offers)
  // misses chained timers: a callback that runs at t=20s and schedules a
  // setTimeout(1000) does so with the clock already at the window end, so the
  // new timer's deadline lands outside the window and never fires.
  //
  // Emulate vitest by advancing in bounded chunks and draining microtasks
  // between chunks. Chunk size is capped at 1000ms so chained sub-second
  // timers are caught; for very long windows the step grows so the loop stays
  // cheap (a few hundred iterations at most).
  const step = ms > 300_000 ? Math.ceil(ms / 300) : 1000;
  let remaining = ms;
  while (remaining > 0) {
    const chunk = Math.min(step, remaining);
    advanceTimersByTime(chunk);
    remaining -= chunk;
    // Drain the SUT's pending microtask chain. We deliberately don't use
    // setImmediate here: with fake timers installed, setImmediate lands in
    // the fake-timer heap and the drain would fire it on the next advance
    // instead of the real loop. (Bun < 1.4 also corrupted the fake-timer
    // heap after ~3700 such calls and threw "Fake timers are not active"
    // mid-test — fixed in 1.4.0, but the fake-heap argument still stands.)
    // A handful of `await Promise.resolve()` turns is enough to drain the
    // typical await chains (mocked resolved promises, `enqueueTask` .then,
    // etc.) without leaking into the fake-timer queue.
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  }
}

export async function runAllTimersAsync(): Promise<void> {
  // Intentionally NOT calling bunTest.jest.runAllTimers(). bun's
  // implementation drains the fake-timer queue by invoking every
  // callback in sequence, regardless of its scheduled deadline. A
  // source that schedules a recurring next-run timer (e.g.
  // ScheduledTaskRuntime.handleFailedExecution → scheduleTask for a
  // cron task) will then re-schedule another timer from inside the
  // callback, and runAllTimers fires that one too, recursively —
  // infinite loop until the test timeout.
  //
  // Tests that need a specific timer to run should call
  // `vi.advanceTimersByTime(ms)` to advance the clock to that
  // timer's deadline first. runAllTimersAsync's only job here is to
  // let the SUT's pending microtasks run on the next event loop turn.
  await Promise.resolve();
}

export function setSystemTime(date?: Date | string | number): void {
  bunTest.setSystemTime(date);
}

export async function waitFor<T>(
  callback: () => T | Promise<T>,
  options?: { timeout?: number; interval?: number },
): Promise<T> {
  const timeout = options?.timeout ?? 5000;
  const interval = options?.interval ?? 50;
  // Use real setTimeout + Date.now captured at module load so polling
  // works even when vi.useFakeTimers() or manual Date.now overrides are
  // active — without this, Date.now never advances and we loop forever.
  const timerFn = _shimRealSetTimeout;
  const fakeTimersActive = bunTest.jest.isFakeTimers();
  const start = _shimRealDateNow();
  let lastError: unknown;
  while (_shimRealDateNow() - start < timeout) {
    try {
      return await callback();
    } catch (error) {
      lastError = error;
      if (fakeTimersActive) {
        // vitest/@testing-library semantics: with fake timers installed,
        // waitFor advances the fake clock instead of waiting on the real
        // one, so timers scheduled by the SUT fire while we poll.
        bunTest.jest.advanceTimersByTime(interval);
        await Promise.resolve();
      } else {
        await new Promise<void>((resolve) => timerFn(resolve, interval));
      }
    }
  }
  throw lastError ?? new Error("vi.waitFor timed out");
}

export async function importActual<T = unknown>(path: string): Promise<T> {
  return (await import(path)) as T;
}

export function mocked<T>(value: T): T {
  return value;
}

export function resetModules(): void {
  // bun has no public resetModules API. Tests that relied on this typically
  // exercised vitest's module cache; under bun, manual `await import()` after
  // `mock.module()` already returns a fresh binding, so most uses degrade
  // gracefully. We keep the call as a documented no-op for source compat.
}

export const vi = {
  fn,
  spyOn,
  mock,
  doMock,
  doUnmock,
  hoisted,
  stubEnv,
  stubGlobal,
  unstubAllEnvs,
  unstubAllGlobals,
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
  advanceTimersByTimeAsync,
  runAllTimersAsync,
  setSystemTime,
  waitFor,
  resetModules,
  restoreAllMocks,
  clearAllMocks,
  importActual,
  mocked,
};

export const describe = bunTest.describe;
export const it = bunTest.it;
export const test = bunTest.test;
export const expect = bunTest.expect;
export const beforeAll = bunTest.beforeAll;
export const beforeEach = bunTest.beforeEach;
export const afterAll = bunTest.afterAll;
export const afterEach = bunTest.afterEach;
export type MockInstance = AnyMock;
export type Mock = AnyMock;
export { mock as bunMock, spyOn as bunSpyOn };

export const shim = {
  describe,
  it,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
  mock,
  spyOn,
  setSystemTime,
  jest: bunTest.jest,
};

export default shim;
