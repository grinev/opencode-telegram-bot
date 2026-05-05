import {
  getScheduledTaskSessionIgnores,
  setScheduledTaskSessionIgnores,
  type ScheduledTaskSessionIgnoreInfo,
} from "../settings/manager.js";

const SCHEDULED_TASK_SESSION_IGNORE_TTL_MS = 24 * 60 * 60 * 1000;

let mutationQueue: Promise<unknown> = Promise.resolve();

function isFreshIgnore(ignore: ScheduledTaskSessionIgnoreInfo, nowMs: number): boolean {
  const createdAtMs = Date.parse(ignore.createdAt);
  return !Number.isNaN(createdAtMs) && nowMs - createdAtMs < SCHEDULED_TASK_SESSION_IGNORE_TTL_MS;
}

function pruneExpiredIgnores(
  ignores: ScheduledTaskSessionIgnoreInfo[],
  nowMs: number,
): ScheduledTaskSessionIgnoreInfo[] {
  return ignores.filter((ignore) => isFreshIgnore(ignore, nowMs));
}

async function mutateIgnores<T>(
  mutator: (ignores: ScheduledTaskSessionIgnoreInfo[]) => {
    ignores: ScheduledTaskSessionIgnoreInfo[];
    result: T;
  },
): Promise<T> {
  const runMutation = async (): Promise<T> => {
    const currentIgnores = getScheduledTaskSessionIgnores();
    const { ignores, result } = mutator(currentIgnores);
    await setScheduledTaskSessionIgnores(ignores);
    return result;
  };

  const mutationPromise = mutationQueue.then(runMutation, runMutation);
  mutationQueue = mutationPromise.catch(() => undefined);
  return mutationPromise;
}

export function isScheduledTaskSessionIgnored(sessionId: string, now = new Date()): boolean {
  const nowMs = now.getTime();
  return getScheduledTaskSessionIgnores().some(
    (ignore) => ignore.sessionId === sessionId && isFreshIgnore(ignore, nowMs),
  );
}

export async function registerScheduledTaskSessionIgnore(
  sessionId: string,
  createdAt = new Date(),
): Promise<void> {
  await mutateIgnores((ignores) => {
    const nowMs = createdAt.getTime();
    const nextIgnores = pruneExpiredIgnores(ignores, nowMs).filter(
      (ignore) => ignore.sessionId !== sessionId,
    );

    return {
      ignores: [...nextIgnores, { sessionId, createdAt: createdAt.toISOString() }],
      result: undefined,
    };
  });
}

export async function removeScheduledTaskSessionIgnore(sessionId: string): Promise<void> {
  await mutateIgnores((ignores) => ({
    ignores: ignores.filter((ignore) => ignore.sessionId !== sessionId),
    result: undefined,
  }));
}

export async function cleanupScheduledTaskSessionIgnores(now = new Date()): Promise<number> {
  return mutateIgnores((ignores) => {
    const nextIgnores = pruneExpiredIgnores(ignores, now.getTime());
    return {
      ignores: nextIgnores,
      result: ignores.length - nextIgnores.length,
    };
  });
}

export function __resetScheduledTaskSessionIgnoreForTests(): void {
  mutationQueue = Promise.resolve();
}
