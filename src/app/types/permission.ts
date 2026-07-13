/**
 * Permission request from OpenCode (maps to SDK PermissionRequest)
 */
export interface PermissionRequest {
  id: string; // Request ID for reply
  sessionID: string;
  permission: string; // "bash", "edit", "webfetch", etc.
  patterns: Array<string>; // Commands/files being requested
  metadata: { [key: string]: unknown }; // Additional context
  always: Array<string>; // Already approved patterns
  tool?: {
    messageID: string;
    callID: string;
  };
}

/**
 * A visible Telegram permission prompt that groups equivalent OpenCode requests
 */
export interface GroupedPermissionMessage {
  messageId: number; // Telegram message ID showing the prompt
  request: PermissionRequest; // The request the visible prompt was rendered from
  count: number; // Number of OpenCode requests grouped behind the prompt
}

/**
 * Possible permission responses
 */
export type PermissionReply = "once" | "always" | "reject";

/**
 * State for active permission requests
 */
export interface PermissionState {
  requestsByMessageId: Map<number, PermissionRequest>; // Telegram message ID -> request
  requestIdsByMessageId: Map<number, string[]>; // Telegram message ID -> OpenCode request IDs
  messageIdBySignature: Map<string, number>; // Equivalent permission signature -> Telegram message ID
}
