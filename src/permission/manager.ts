import { PermissionRequest, PermissionState } from "./types.js";
import { logger } from "../utils/logger.js";

class PermissionManager {
  private state: PermissionState = {
    request: null,
    messageId: null,
    isActive: false,
  };

  /**
   * Start a new permission request
   */
  startPermission(request: PermissionRequest): void {
    logger.debug(
      `[PermissionManager] startPermission: id=${request.id}, permission=${request.permission}`,
    );

    if (this.state.isActive) {
      logger.warn("[PermissionManager] Permission already active, replacing");
      this.clear();
    }

    logger.info(
      `[PermissionManager] New permission request: type=${request.permission}, patterns=${request.patterns.join(", ")}`,
    );

    this.state = {
      request,
      messageId: null,
      isActive: true,
    };
  }

  /**
   * Get current permission request
   */
  getRequest(): PermissionRequest | null {
    return this.state.request;
  }

  /**
   * Get request ID for API reply
   */
  getRequestID(): string | null {
    return this.state.request?.id ?? null;
  }

  /**
   * Get permission type (bash, edit, etc.)
   */
  getPermissionType(): string | null {
    return this.state.request?.permission ?? null;
  }

  /**
   * Get patterns (commands/files)
   */
  getPatterns(): string[] {
    return this.state.request?.patterns ?? [];
  }

  /**
   * Set Telegram message ID for later deletion
   */
  setMessageId(messageId: number): void {
    this.state.messageId = messageId;
  }

  /**
   * Check if callback message ID belongs to active permission request
   */
  isActiveMessage(messageId: number | null): boolean {
    return (
      this.state.isActive && this.state.messageId !== null && messageId === this.state.messageId
    );
  }

  /**
   * Get Telegram message ID
   */
  getMessageId(): number | null {
    return this.state.messageId;
  }

  /**
   * Check if permission request is active
   */
  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * Clear state after reply
   */
  clear(): void {
    logger.debug("[PermissionManager] Clearing permission state");
    this.state = {
      request: null,
      messageId: null,
      isActive: false,
    };
  }
}

export const permissionManager = new PermissionManager();
