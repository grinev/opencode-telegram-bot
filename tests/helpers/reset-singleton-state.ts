interface SummaryAggregatorPrivateState {
  onCompleteCallback: null;
  onToolCallback: null;
  onToolFileCallback: null;
  onQuestionCallback: null;
  onQuestionErrorCallback: null;
  onThinkingCallback: null;
  onTokensCallback: null;
  onSessionCompactedCallback: null;
  onPermissionCallback: null;
  onSessionDiffCallback: null;
  onFileChangeCallback: null;
  bot: null;
  chatId: null;
}

interface KeyboardManagerPrivateState {
  state: null;
  api: null;
  chatId: null;
  lastUpdateTime: number;
}

interface PinnedMessageManagerPrivateState {
  api: null;
  chatId: null;
  contextLimit: null;
  updateDebounceTimer: ReturnType<typeof setTimeout> | null;
  onKeyboardUpdateCallback: undefined;
  state: {
    messageId: null;
    chatId: null;
    sessionId: null;
    sessionTitle: string;
    projectName: string;
    tokensUsed: number;
    tokensLimit: number;
    lastUpdated: number;
    changedFiles: Array<{ file: string; additions: number; deletions: number }>;
  };
}

interface ProcessManagerPrivateState {
  state: {
    process: null;
    pid: null;
    startTime: null;
    isRunning: boolean;
  };
}

export async function resetSingletonState(): Promise<void> {
  const [
    { questionManager },
    { permissionManager },
    { interactionManager },
    { summaryAggregator },
    { keyboardManager },
    { pinnedMessageManager },
    { processManager },
    { stopEventListening },
    { __resetSessionDirectoryCacheForTests },
  ] = await Promise.all([
    import("../../src/question/manager.js"),
    import("../../src/permission/manager.js"),
    import("../../src/interaction/manager.js"),
    import("../../src/summary/aggregator.js"),
    import("../../src/keyboard/manager.js"),
    import("../../src/pinned/manager.js"),
    import("../../src/process/manager.js"),
    import("../../src/opencode/events.js"),
    import("../../src/session/cache-manager.js"),
  ]);

  stopEventListening();
  questionManager.clear();
  permissionManager.clear();
  interactionManager.clear("test_reset");
  summaryAggregator.clear();

  const aggregator = summaryAggregator as unknown as SummaryAggregatorPrivateState;
  aggregator.onCompleteCallback = null;
  aggregator.onToolCallback = null;
  aggregator.onToolFileCallback = null;
  aggregator.onQuestionCallback = null;
  aggregator.onQuestionErrorCallback = null;
  aggregator.onThinkingCallback = null;
  aggregator.onTokensCallback = null;
  aggregator.onSessionCompactedCallback = null;
  aggregator.onPermissionCallback = null;
  aggregator.onSessionDiffCallback = null;
  aggregator.onFileChangeCallback = null;
  aggregator.bot = null;
  aggregator.chatId = null;

  const keyboard = keyboardManager as unknown as KeyboardManagerPrivateState;
  keyboard.state = null;
  keyboard.api = null;
  keyboard.chatId = null;
  keyboard.lastUpdateTime = 0;

  const pinned = pinnedMessageManager as unknown as PinnedMessageManagerPrivateState;
  if (pinned.updateDebounceTimer) {
    clearTimeout(pinned.updateDebounceTimer);
  }
  pinned.updateDebounceTimer = null;
  pinned.api = null;
  pinned.chatId = null;
  pinned.contextLimit = null;
  pinned.onKeyboardUpdateCallback = undefined;
  pinned.state = {
    messageId: null,
    chatId: null,
    sessionId: null,
    sessionTitle: "new session",
    projectName: "",
    tokensUsed: 0,
    tokensLimit: 0,
    lastUpdated: 0,
    changedFiles: [],
  };

  const process = processManager as unknown as ProcessManagerPrivateState;
  process.state = {
    process: null,
    pid: null,
    startTime: null,
    isRunning: false,
  };

  __resetSessionDirectoryCacheForTests();
}
