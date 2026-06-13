export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}

export interface CachedSessionDirectory {
  worktree: string;
  lastUpdated: number;
}

export interface SessionDirectoryProject {
  id: string;
  worktree: string;
  name: string;
  lastUpdated: number;
}

export interface SessionDirectoryCacheInfo {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: CachedSessionDirectory[];
}
