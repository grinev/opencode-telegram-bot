export interface GitWorktreeEntry {
  path: string;
  branch: string | null;
  isCurrent: boolean;
  isMain: boolean;
}

export interface GitWorktreeContext {
  mainProjectPath: string;
  activeWorktreePath: string;
  branch: string | null;
  isLinkedWorktree: boolean;
  worktrees: GitWorktreeEntry[];
}
