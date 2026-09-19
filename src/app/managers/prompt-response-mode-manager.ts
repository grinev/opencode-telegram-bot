export type PromptResponseMode = "text_only" | "text_and_tts";

const promptResponseModes = new Map<string, Map<string, PromptResponseMode>>();

export function setPromptResponseMode(
  sessionId: string,
  messageId: string,
  responseMode: PromptResponseMode,
): void {
  const modes = promptResponseModes.get(sessionId) ?? new Map<string, PromptResponseMode>();
  modes.set(messageId, responseMode);
  promptResponseModes.set(sessionId, modes);
}

export function clearPromptResponseMode(sessionId: string, messageId?: string): void {
  if (!messageId) {
    promptResponseModes.delete(sessionId);
    return;
  }

  const modes = promptResponseModes.get(sessionId);
  modes?.delete(messageId);
  if (modes?.size === 0) {
    promptResponseModes.delete(sessionId);
  }
}

export function consumePromptResponseMode(
  sessionId: string,
  messageId: string,
): PromptResponseMode | null {
  const responseMode = promptResponseModes.get(sessionId)?.get(messageId) ?? null;
  clearPromptResponseMode(sessionId, messageId);
  return responseMode;
}
