import type {
  GroupedPermissionMessage,
  PermissionRequest,
  PermissionState,
} from "../types/permission.js";
import type { InteractionManager } from "./interaction-manager.js";
import { logger } from "../../utils/logger.js";

/**
 * Why a sent permission message was not registered. A stale or resolved
 * request is dropped; one refused because a poll holds the slot has to wait.
 */
export type StartPermissionResult = "started" | "stale" | "resolved" | "question_active";

function createEmptyState(): PermissionState {
  return {
    requestsByMessageId: new Map(),
    requestIdsByMessageId: new Map(),
    messageIdBySignature: new Map(),
  };
}

export class PermissionManager {
  private resolvedRequestIDs = new Set<string>();
  private resolvedGeneration = 0;

  constructor(private readonly interactionManager: InteractionManager) {}

  private get state(): PermissionState | null {
    return this.interactionManager.getPayload("permission");
  }

  /**
   * Resolved ids only matter within one generation; a reset forgets them.
   */
  private getResolvedRequestIDs(): Set<string> {
    const generation = this.interactionManager.getGeneration();
    if (generation !== this.resolvedGeneration) {
      this.resolvedRequestIDs.clear();
      this.resolvedGeneration = generation;
    }

    return this.resolvedRequestIDs;
  }

  private getRequestSignature(request: PermissionRequest): string {
    return JSON.stringify({
      sessionID: request.sessionID,
      permission: request.permission,
      patterns: [...request.patterns].sort(),
    });
  }

  /**
   * Check whether a request can still be shown in the given generation
   */
  getDropReason(
    request: PermissionRequest,
    generation: number = this.getGeneration(),
  ): "stale" | "resolved" | null {
    if (generation !== this.getGeneration()) {
      return "stale";
    }

    return this.getResolvedRequestIDs().has(request.id) ? "resolved" : null;
  }

  /**
   * Register a new permission request message
   */
  startPermission(
    request: PermissionRequest,
    messageId: number,
    generation: number = this.getGeneration(),
  ): StartPermissionResult {
    logger.debug(
      `[PermissionManager] startPermission: id=${request.id}, permission=${request.permission}, messageId=${messageId}`,
    );

    const dropReason = this.getDropReason(request, generation);
    if (dropReason) {
      logger.debug(
        `[PermissionManager] Ignoring ${dropReason} request: id=${request.id}`,
      );
      return dropReason;
    }

    if (this.interactionManager.getSnapshot()?.kind === "question") {
      logger.info(
        `[PermissionManager] Poll is on screen, not registering permission: id=${request.id}`,
      );
      return "question_active";
    }

    let state = this.state;
    if (!state) {
      state = createEmptyState();
      this.interactionManager.start({
        kind: "permission",
        expectedInput: "callback",
        payload: state,
      });
    }

    const previous = state.requestsByMessageId.get(messageId);
    if (previous) {
      logger.warn(`[PermissionManager] Message ID already tracked, replacing: ${messageId}`);
      // Drop the replaced request's signature so it cannot later group new
      // requests behind a message that now shows something else.
      state.messageIdBySignature.delete(this.getRequestSignature(previous));
    }

    state.requestsByMessageId.set(messageId, request);
    state.requestIdsByMessageId.set(messageId, [request.id]);
    state.messageIdBySignature.set(this.getRequestSignature(request), messageId);

    logger.info(
      `[PermissionManager] New permission request: type=${request.permission}, patterns=${request.patterns.join(", ")}, pending=${state.requestsByMessageId.size}`,
    );

    return "started";
  }

  /**
   * Attach an equivalent OpenCode request to an already visible Telegram permission message.
   */
  addEquivalentRequest(
    request: PermissionRequest,
    generation: number = this.getGeneration(),
  ): GroupedPermissionMessage | null {
    if (this.getDropReason(request, generation)) {
      logger.debug(
        `[PermissionManager] Ignoring stale or already resolved equivalent request: id=${request.id}`,
      );
      return null;
    }

    const state = this.state;
    if (!state) {
      return null;
    }

    const signature = this.getRequestSignature(request);
    const messageId = state.messageIdBySignature.get(signature);
    if (messageId === undefined) {
      return null;
    }

    const visibleRequest = state.requestsByMessageId.get(messageId);
    if (!visibleRequest) {
      logger.warn(
        `[PermissionManager] Dropping orphan permission signature: messageId=${messageId}`,
      );
      state.messageIdBySignature.delete(signature);
      return null;
    }

    const requestIds = state.requestIdsByMessageId.get(messageId) ?? [];
    if (!requestIds.includes(request.id)) {
      requestIds.push(request.id);
      state.requestIdsByMessageId.set(messageId, requestIds);
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

    return this.state?.requestsByMessageId.get(messageId) ?? null;
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

    return [...(this.state?.requestIdsByMessageId.get(messageId) ?? [])];
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
    return messageId !== null && (this.state?.requestsByMessageId.has(messageId) ?? false);
  }

  /**
   * Get latest Telegram message ID
   */
  getMessageId(): number | null {
    const messageIds = this.getMessageIds();
    if (messageIds.length === 0) {
      return null;
    }

    return messageIds[messageIds.length - 1] ?? null;
  }

  /**
   * Get Telegram message IDs for all active requests
   */
  getMessageIds(): number[] {
    return Array.from(this.state?.requestsByMessageId.keys() ?? []);
  }

  /**
   * Remove permission request by Telegram message ID
   */
  removeByMessageId(messageId: number | null): PermissionRequest | null {
    const state = this.state;
    const request = this.getRequest(messageId);
    if (!state || !request || messageId === null) {
      return null;
    }

    state.requestsByMessageId.delete(messageId);
    state.requestIdsByMessageId.delete(messageId);
    state.messageIdBySignature.delete(this.getRequestSignature(request));

    logger.debug(
      `[PermissionManager] Removed permission request: id=${request.id}, messageId=${messageId}, pending=${state.requestsByMessageId.size}`,
    );

    return request;
  }

  /**
   * Remove all Telegram messages tracking an OpenCode permission request ID,
   * and drop the request if it is still waiting behind a poll
   */
  resolveRequest(requestID: string): number[] {
    this.getResolvedRequestIDs().add(requestID);
    this.interactionManager.dropWaitingPermission(requestID);

    const state = this.state;
    const removedMessageIds: number[] = [];
    if (!state) {
      return removedMessageIds;
    }

    for (const [messageId, request] of state.requestsByMessageId) {
      const requestIds = state.requestIdsByMessageId.get(messageId) ?? [request.id];
      if (!requestIds.includes(requestID)) {
        continue;
      }

      state.requestsByMessageId.delete(messageId);
      state.requestIdsByMessageId.delete(messageId);
      state.messageIdBySignature.delete(this.getRequestSignature(request));
      removedMessageIds.push(messageId);
    }

    if (removedMessageIds.length > 0) {
      logger.debug(
        `[PermissionManager] Removed resolved permission request: id=${requestID}, messages=${removedMessageIds.length}, pending=${state.requestsByMessageId.size}`,
      );
    }

    return removedMessageIds;
  }

  isResolved(requestID: string): boolean {
    return this.getResolvedRequestIDs().has(requestID);
  }

  getGeneration(): number {
    return this.interactionManager.getGeneration();
  }

  /**
   * Get number of active permission requests
   */
  getPendingCount(): number {
    return this.state?.requestsByMessageId.size ?? 0;
  }

  /**
   * Check if there are active permission requests
   */
  isActive(): boolean {
    return this.getPendingCount() > 0;
  }

  /**
   * Drop every permission prompt and mark prompts still being sent as stale
   */
  clear(): void {
    logger.debug(
      `[PermissionManager] Clearing permission state: pending=${this.getPendingCount()}`,
    );

    // Bump first, so a poll released by this clear carries the new generation.
    this.interactionManager.bumpGeneration();
    this.interactionManager.clearKind("permission", "permission_cleared");
  }
}
