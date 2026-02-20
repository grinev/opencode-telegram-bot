import { logger } from "../utils/logger.js";

interface RenameState {
  isWaiting: boolean;
  sessionId: string | null;
  sessionDirectory: string | null;
  currentTitle: string | null;
  messageId: number | null;
}

class RenameManager {
  private state: RenameState = {
    isWaiting: false,
    sessionId: null,
    sessionDirectory: null,
    currentTitle: null,
    messageId: null,
  };

  startWaiting(sessionId: string, directory: string, currentTitle: string): void {
    logger.info(`[RenameManager] Starting rename flow for session: ${sessionId}`);
    this.state = {
      isWaiting: true,
      sessionId,
      sessionDirectory: directory,
      currentTitle,
      messageId: null,
    };
  }

  setMessageId(messageId: number): void {
    this.state.messageId = messageId;
  }

  getMessageId(): number | null {
    return this.state.messageId;
  }

  isActiveMessage(messageId: number | null): boolean {
    return (
      this.state.isWaiting && this.state.messageId !== null && this.state.messageId === messageId
    );
  }

  isWaitingForName(): boolean {
    return this.state.isWaiting;
  }

  getSessionInfo(): { sessionId: string; directory: string; currentTitle: string } | null {
    if (!this.state.isWaiting || !this.state.sessionId) {
      return null;
    }
    return {
      sessionId: this.state.sessionId,
      directory: this.state.sessionDirectory!,
      currentTitle: this.state.currentTitle!,
    };
  }

  clear(): void {
    logger.debug("[RenameManager] Clearing rename state");
    this.state = {
      isWaiting: false,
      sessionId: null,
      sessionDirectory: null,
      currentTitle: null,
      messageId: null,
    };
  }
}

export const renameManager = new RenameManager();
