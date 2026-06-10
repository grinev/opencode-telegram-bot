import {
  getCurrentSession as getSettingsSession,
  setCurrentSession as setSettingsSession,
  clearSession as clearSettingsSession,
} from "../stores/settings-store.js";
import type { SessionInfo } from "../types/session.js";

export type { SessionInfo };

export function setCurrentSession(sessionInfo: SessionInfo): void {
  setSettingsSession(sessionInfo);
}

export function getCurrentSession(): SessionInfo | null {
  return getSettingsSession() ?? null;
}

export function clearSession(): void {
  clearSettingsSession();
}
