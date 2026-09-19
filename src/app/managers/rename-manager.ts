import type { RenameState } from "../types/rename.js";
import type { InteractionManager } from "./interaction-manager.js";
import { logger } from "../../utils/logger.js";

export class RenameManager {
  constructor(private readonly interactionManager: InteractionManager) {}

  private get state(): RenameState | null {
    return this.interactionManager.getPayload("rename");
  }

  startWaiting(sessionId: string, directory: string, currentTitle: string): void {
    logger.info(`[RenameManager] Starting rename flow for session: ${sessionId}`);
    this.interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      payload: {
        sessionId,
        sessionDirectory: directory,
        currentTitle,
        messageId: null,
      },
    });
  }

  setMessageId(messageId: number): void {
    const state = this.state;
    if (state) {
      state.messageId = messageId;
    }
  }

  getMessageId(): number | null {
    return this.state?.messageId ?? null;
  }

  isActiveMessage(messageId: number | null): boolean {
    const activeMessageId = this.getMessageId();
    return activeMessageId !== null && activeMessageId === messageId;
  }

  isWaitingForName(): boolean {
    return this.state !== null;
  }

  getSessionInfo(): { sessionId: string; directory: string; currentTitle: string } | null {
    const state = this.state;
    if (!state || !state.sessionId) {
      return null;
    }
    return {
      sessionId: state.sessionId,
      directory: state.sessionDirectory,
      currentTitle: state.currentTitle,
    };
  }

  clear(): void {
    logger.debug("[RenameManager] Clearing rename state");
    this.interactionManager.clearKind("rename", "rename_cleared");
  }
}
