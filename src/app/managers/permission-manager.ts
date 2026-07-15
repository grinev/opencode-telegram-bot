import type { PermissionRequest, PermissionState } from "../types/permission.js";
import { logger } from "../../utils/logger.js";

class PermissionManager {
  private state: PermissionState = {
    requestsByMessageId: new Map(),
  };
  private resolvedRequestIDs = new Set<string>();
  private generation = 0;

  /**
   * Register a new permission request message
   */
  startPermission(
    request: PermissionRequest,
    messageId: number,
    generation: number = this.generation,
  ): boolean {
    logger.debug(
      `[PermissionManager] startPermission: id=${request.id}, permission=${request.permission}, messageId=${messageId}`,
    );

    if (generation !== this.generation || this.resolvedRequestIDs.has(request.id)) {
      logger.debug(
        `[PermissionManager] Ignoring stale or already resolved request: id=${request.id}`,
      );
      return false;
    }

    if (this.state.requestsByMessageId.has(messageId)) {
      logger.warn(`[PermissionManager] Message ID already tracked, replacing: ${messageId}`);
    }

    this.state.requestsByMessageId.set(messageId, request);

    logger.info(
      `[PermissionManager] New permission request: type=${request.permission}, patterns=${request.patterns.join(", ")}, pending=${this.state.requestsByMessageId.size}`,
    );

    return true;
  }

  /**
   * Get permission request by Telegram message ID
   */
  getRequest(messageId: number | null): PermissionRequest | null {
    if (messageId === null) {
      return null;
    }

    return this.state.requestsByMessageId.get(messageId) ?? null;
  }

  /**
   * Get request ID for API reply by Telegram message ID
   */
  getRequestID(messageId: number | null): string | null {
    return this.getRequest(messageId)?.id ?? null;
  }

  /**
   * Get permission type (bash, edit, etc.) by message ID
   */
  getPermissionType(messageId: number | null): string | null {
    return this.getRequest(messageId)?.permission ?? null;
  }

  /**
   * Get patterns (commands/files) by message ID
   */
  getPatterns(messageId: number | null): string[] {
    return this.getRequest(messageId)?.patterns ?? [];
  }

  /**
   * Check if callback message ID belongs to active permission request
   */
  isActiveMessage(messageId: number | null): boolean {
    return messageId !== null && this.state.requestsByMessageId.has(messageId);
  }

  /**
   * Get latest Telegram message ID
   */
  getMessageId(): number | null {
    const messageIds = this.getMessageIds();
    if (messageIds.length === 0) {
      return null;
    }

    return messageIds[messageIds.length - 1];
  }

  /**
   * Get Telegram message IDs for all active requests
   */
  getMessageIds(): number[] {
    return Array.from(this.state.requestsByMessageId.keys());
  }

  /**
   * Remove permission request by Telegram message ID
   */
  removeByMessageId(messageId: number | null): PermissionRequest | null {
    const request = this.getRequest(messageId);
    if (!request || messageId === null) {
      return null;
    }

    this.state.requestsByMessageId.delete(messageId);

    logger.debug(
      `[PermissionManager] Removed permission request: id=${request.id}, messageId=${messageId}, pending=${this.state.requestsByMessageId.size}`,
    );

    return request;
  }

  /**
   * Remove all Telegram messages tracking an OpenCode permission request ID
   */
  resolveRequest(requestID: string): number[] {
    this.resolvedRequestIDs.add(requestID);
    const removedMessageIds: number[] = [];

    for (const [messageId, request] of this.state.requestsByMessageId) {
      if (request.id !== requestID) {
        continue;
      }

      this.state.requestsByMessageId.delete(messageId);
      removedMessageIds.push(messageId);
    }

    if (removedMessageIds.length > 0) {
      logger.debug(
        `[PermissionManager] Removed resolved permission request: id=${requestID}, messages=${removedMessageIds.length}, pending=${this.state.requestsByMessageId.size}`,
      );
    }

    return removedMessageIds;
  }

  isResolved(requestID: string): boolean {
    return this.resolvedRequestIDs.has(requestID);
  }

  getGeneration(): number {
    return this.generation;
  }

  /**
   * Get number of active permission requests
   */
  getPendingCount(): number {
    return this.state.requestsByMessageId.size;
  }

  /**
   * Check if there are active permission requests
   */
  isActive(): boolean {
    return this.state.requestsByMessageId.size > 0;
  }

  /**
   * Clear state after reply
   */
  clear(): void {
    logger.debug(
      `[PermissionManager] Clearing permission state: pending=${this.state.requestsByMessageId.size}`,
    );

    this.state = {
      requestsByMessageId: new Map(),
    };
    this.resolvedRequestIDs.clear();
    this.generation++;
  }
}

export const permissionManager = new PermissionManager();
