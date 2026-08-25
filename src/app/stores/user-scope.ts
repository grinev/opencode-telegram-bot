import { AsyncLocalStorage } from "node:async_hooks";

// Per-operator request scope. Set by authMiddleware around every Telegram
// update; consumed by the settings store so each operator gets an isolated
// session tape. Server-originated work (event streams, boot) runs outside any
// scope and falls back to the legacy single-session pointer.
export interface UserScope {
  userId: number;
}

export const userScope = new AsyncLocalStorage<UserScope>();

export function scopedUserId(): number | undefined {
  return userScope.getStore()?.userId;
}
