import type {
  GroupedPermissionMessage,
  PermissionRequest,
  PermissionState,
} from "../types/permission.js";
import { logger } from "../../utils/logger.js";

class PermissionManager {
  private state: PermissionState = {
    requestsByMessageId: new Map(),
    requestIdsByMessageId: new Map(),
    messageIdBySignature: new Map(),
  };
  private resolvedRequestIDs = new Set<string>();
  private generation = 0;

  private getRequestSignature(request: PermissionRequest): string {
    return JSON.stringify({
      sessionID: request.sessionID,
      permission: request.permission,
      patterns: [...request.patterns].sort(),
    });
  }

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

    const previous = this.state.requestsByMessageId.get(messageId);
    if (previous) {
      logger.warn(`[PermissionManager] Message ID already tracked, replacing: ${messageId}`);
      // Drop the replaced request's signature so it cannot later group new
      // requests behind a message that now shows something else.
      this.state.messageIdBySignature.delete(this.getRequestSignature(previous));
    }

    this.state.requestsByMessageId.set(messageId, request);
    this.state.requestIdsByMessageId.set(messageId, [request.id]);
    this.state.messageIdBySignature.set(this.getRequestSignature(request), messageId);

    logger.info(
      `[PermissionManager] New permission request: type=${request.permission}, patterns=${request.patterns.join(", ")}, pending=${this.state.requestsByMessageId.size}`,
    );

    return true;
  }

  /**
   * Attach an equivalent OpenCode request to an already visible Telegram permission message.
   */
  addEquivalentRequest(
    request: PermissionRequest,
    generation: number = this.generation,
  ): GroupedPermissionMessage | null {
    if (generation !== this.generation || this.resolvedRequestIDs.has(request.id)) {
      logger.debug(
        `[PermissionManager] Ignoring stale or already resolved equivalent request: id=${request.id}`,
      );
      return null;
    }

    const signature = this.getRequestSignature(request);
    const messageId = this.state.messageIdBySignature.get(signature);
    if (messageId === undefined) {
      return null;
    }

    const visibleRequest = this.state.requestsByMessageId.get(messageId);
    if (!visibleRequest) {
      logger.warn(
        `[PermissionManager] Dropping orphan permission signature: messageId=${messageId}`,
      );
      this.state.messageIdBySignature.delete(signature);
      return null;
    }

    const requestIds = this.state.requestIdsByMessageId.get(messageId) ?? [];
    if (!requestIds.includes(request.id)) {
      requestIds.push(request.id);
      this.state.requestIdsByMessageId.set(messageId, requestIds);
    }

    logger.info(
      `[PermissionManager] Merged equivalent permission request: id=${request.id}, messageId=${messageId}, grouped=${requestIds.length}`,
    );

    return { messageId, request: visibleRequest, count: requestIds.length };
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
   * Get all OpenCode request IDs grouped behind a Telegram message.
   */
  getRequestIDs(messageId: number | null): string[] {
    if (messageId === null) {
      return [];
    }

    return [...(this.state.requestIdsByMessageId.get(messageId) ?? [])];
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
    this.state.requestIdsByMessageId.delete(messageId);
    this.state.messageIdBySignature.delete(this.getRequestSignature(request));

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
      const requestIds = this.state.requestIdsByMessageId.get(messageId) ?? [request.id];
      if (!requestIds.includes(requestID)) {
        continue;
      }

      this.state.requestsByMessageId.delete(messageId);
      this.state.requestIdsByMessageId.delete(messageId);
      this.state.messageIdBySignature.delete(this.getRequestSignature(request));
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
      requestIdsByMessageId: new Map(),
      messageIdBySignature: new Map(),
    };
    this.resolvedRequestIDs.clear();
    this.generation++;
  }
}

export const permissionManager = new PermissionManager();
