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
 * Possible permission responses
 */
export type PermissionReply = "once" | "always" | "reject";

/**
 * State for active permission requests
 */
export interface PermissionState {
  requestsByMessageId: Map<number, PermissionRequest>; // Telegram message ID -> request
}
