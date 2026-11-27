import {
  getCurrentSession as getSettingsSession,
  setCurrentSession as setSettingsSession,
  clearSession as clearSettingsSession,
} from "../stores/settings-store.js";
import { withdrawPromptQueue } from "./prompt-inbox-service.js";
import { promptAttachment } from "../managers/prompt-attachment-manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { isExpectedOpencodeUnavailableError } from "../../utils/opencode-error.js";
import type { SessionInfo } from "../types/session.js";

export type { SessionInfo };

export function setCurrentSession(sessionInfo: SessionInfo): void {
  // Renaming reuses this setter with the same id, so only an actual session
  // switch may drop prompts queued for the previous session.
  if (getSettingsSession()?.id !== sessionInfo.id) {
    void withdrawPromptQueue("session_switched");
    promptAttachment.clear("session_switched");
  }

  setSettingsSession(sessionInfo);
}

export function getCurrentSession(): SessionInfo | null {
  return getSettingsSession() ?? null;
}

/** Commit metadata only, without triggering a selection change or touching queued prompts. */
export function updateSelectedSessionTitle(sessionId: string, title: string): SessionInfo | null {
  const current = getCurrentSession();
  if (!current || current.id !== sessionId || !title.trim() || current.title === title) {
    return null;
  }
  setSettingsSession({ ...current, title });
  return current;
}

/** Ignore a delayed read if a switch or newer title already reached the store. */
export async function reconcileSelectedSessionTitle(session: SessionInfo): Promise<SessionInfo | null> {
  const title = await fetchSessionTitle(session);
  return getCurrentSession() === session ? updateSelectedSessionTitle(session.id, title) : null;
}

/**
 * Title OpenCode has for the session now. The remembered one goes stale once
 * OpenCode names a session after its first prompt, so it is only the fallback.
 */
export async function fetchSessionTitle(session: SessionInfo): Promise<string> {
  try {
    const { data, error } = await opencodeClient.session.get({
      sessionID: session.id,
      directory: session.directory,
    });

    if (!error && data) {
      return data.title;
    }

    logger.debug(`[SessionService] Could not fetch title for session ${session.id}:`, error);
  } catch (error) {
    if (isExpectedOpencodeUnavailableError(error)) {
      logger.debug("[SessionService] OpenCode server unavailable; using remembered session title");
    } else {
      logger.debug(`[SessionService] Could not fetch title for session ${session.id}:`, error);
    }
  }

  return session.title;
}

export function clearSession(): void {
  void withdrawPromptQueue("session_cleared");
  promptAttachment.clear("session_cleared");
  clearSettingsSession();
}
