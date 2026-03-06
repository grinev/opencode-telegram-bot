import {
  getCurrentSession as getSettingsSession,
  setCurrentSession as setSettingsSession,
  clearSession as clearSettingsSession,
  SessionInfo,
} from "../settings/manager.js";

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

export function updateCurrentSessionTitle(sessionId: string, title: string): void {
  const currentSession = getCurrentSession();
  if (!currentSession || currentSession.id !== sessionId || currentSession.title === title) {
    return;
  }

  setSettingsSession({
    ...currentSession,
    title,
  });
}
