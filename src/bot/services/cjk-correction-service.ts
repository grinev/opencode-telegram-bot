import { t } from "../../i18n/index.js";
import { externalUserInputSuppressionManager } from "../../app/managers/external-input-suppression-manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { sanitizeCjkText } from "../render/cjk-guard.js";

/**
 * Automatic CJK correction: when an assistant message arrives in Chinese /
 * Japanese / Korean, the bot asks the model to rewrite the exact same content
 * in Spanish and replaces the message with a notice while waiting. The rewrite
 * arrives as a regular assistant message in the same session.
 */
const CORRECTION_PROMPT =
  "⚠️ [Corrección automática] Tu respuesta anterior salió en otro alfabeto (chino/japonés/coreano) y NO se entregó al usuario. Reescribe exactamente ese mismo contenido en español, íntegro y sin ningún carácter CJK. No resumas ni omitas nada; mantén el formato (títulos, listas, tablas, negritas).";

/** Stray CJK fragments below this size are stripped without a rewrite. */
const MIN_CJK_FOR_CORRECTION = 12;
/** Maximum rewrite requests per consecutive CJK streak. */
const MAX_CORRECTION_ATTEMPTS = 2;

const attemptsBySession = new Map<string, number>();

export interface CjkCorrectionContext {
  directory: string | undefined;
  agent?: string | undefined;
  providerID?: string | undefined;
  modelID?: string | undefined;
}

export interface CjkCorrectionPlan {
  /** Text to deliver instead of the raw message (localized notice), or null. */
  replacementText: string | null;
  /** Whether a Spanish rewrite was requested from the model. */
  correctionRequested: boolean;
  /** Message text with CJK stripped (the original text when there was none). */
  sanitizedText: string;
}

export async function planCjkCorrection(
  sessionId: string,
  context: CjkCorrectionContext,
  messageText: string,
): Promise<CjkCorrectionPlan> {
  const result = sanitizeCjkText(messageText);
  const sanitizedText = result.text;

  if (result.removed === 0) {
    attemptsBySession.delete(sessionId);
    return { replacementText: null, correctionRequested: false, sanitizedText };
  }

  const significant = result.blocked || result.removed >= MIN_CJK_FOR_CORRECTION;
  if (!significant) {
    attemptsBySession.delete(sessionId);
    return { replacementText: null, correctionRequested: false, sanitizedText };
  }

  const previousAttempts = attemptsBySession.get(sessionId) ?? 0;
  if (previousAttempts >= MAX_CORRECTION_ATTEMPTS) {
    attemptsBySession.delete(sessionId);
    logger.warn("[CjkGuard] Correction attempts exhausted", {
      sessionId,
      removed: result.removed,
      blocked: result.blocked,
    });
    return {
      replacementText: result.blocked ? t("cjk_guard.blocked_notice") : null,
      correctionRequested: false,
      sanitizedText,
    };
  }

  attemptsBySession.set(sessionId, previousAttempts + 1);

  try {
    externalUserInputSuppressionManager.register(sessionId, CORRECTION_PROMPT);
    await opencodeClient.session.promptAsync({
      sessionID: sessionId,
      directory: context.directory,
      parts: [{ type: "text", text: CORRECTION_PROMPT }],
      ...(context.agent ? { agent: context.agent } : {}),
      ...(context.providerID && context.modelID
        ? { model: { providerID: context.providerID, modelID: context.modelID } }
        : {}),
    });
    logger.warn(`[CjkGuard] Requested Spanish rewrite (attempt ${previousAttempts + 1})`, {
      sessionId,
      removed: result.removed,
      blocked: result.blocked,
    });
  } catch (error) {
    attemptsBySession.delete(sessionId);
    logger.error("[CjkGuard] Failed to request Spanish rewrite", error);
    return {
      replacementText: result.blocked ? t("cjk_guard.blocked_notice") : null,
      correctionRequested: false,
      sanitizedText,
    };
  }

  return {
    replacementText: result.blocked ? t("cjk_guard.correcting_notice") : null,
    correctionRequested: true,
    sanitizedText,
  };
}

/** Test-only: clears attempt counters. */
export function _resetCjkCorrectionState(): void {
  attemptsBySession.clear();
}
