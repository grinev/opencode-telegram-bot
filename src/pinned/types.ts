/**
 * Token information from AssistantMessage
 */
export interface TokensInfo {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * File change info from OpenCode session diff
 */
export interface FileChange {
  file: string;
  additions: number;
  deletions: number;
}

/**
 * State of the pinned status message
 */
export interface PinnedMessageState {
  messageId: number | null;
  chatId: number | null;
  messageThreadId?: number | null;
  sessionId: string | null;
  sessionTitle: string;
  attachActive: boolean;
  attachBusy: boolean;
  projectPath: string;
  projectBranch: string | null;
  projectWorktreePath: string | null;
  tokensUsed: number;
  tokensLimit: number;
  lastUpdated: number;
  changedFiles: FileChange[];
  cost?: number;
}
