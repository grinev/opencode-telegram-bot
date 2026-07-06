interface SummaryAggregatorPrivateState {
  onCompleteCallback: null;
  onPartialCallback: null;
  onToolCallback: null;
  onToolFileCallback: null;
  onQuestionCallback: null;
  onQuestionErrorCallback: null;
  onThinkingCallback: null;
  onTokensCallback: null;
  onSessionCompactedCallback: null;
  onSessionErrorCallback: null;
  onPermissionCallback: null;
  onSessionDiffCallback: null;
  onFileChangeCallback: null;
  bot: null;
  chatId: null;
  typingIndicatorEnabled: boolean;
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
    projectBranch: string | null;
    tokensUsed: number;
    tokensLimit: number;
    lastUpdated: number;
    changedFiles: Array<{ file: string; additions: number; deletions: number }>;
  };
}

export async function resetSingletonState(): Promise<void> {
  const [
    { questionManager },
    { permissionManager },
    { renameManager },
    { interactionManager },
    { summaryAggregator },
    { keyboardManager },
    { pinnedMessageManager },
    { stopEventListening },
    { __resetSessionDirectoryCacheForTests },
    { __resetMessageMergerForTests },
    loggerModule,
  ] = await Promise.all([
    import("../../src/app/managers/question-manager.js"),
    import("../../src/app/managers/permission-manager.js"),
    import("../../src/app/managers/rename-manager.js"),
    import("../../src/app/managers/interaction-manager.js"),
    import("../../src/app/managers/summary-aggregation-manager.js"),
    import("../../src/bot/keyboards/keyboard-manager.js"),
    import("../../src/bot/pinned/pinned-message-manager.js"),
    import("../../src/opencode/events.js"),
    import("../../src/app/services/session-cache-service.js"),
    import("../../src/bot/handlers/message-merger.js"),
    import("../../src/utils/logger.js"),
  ]);

  stopEventListening();
  questionManager.clear();
  permissionManager.clear();
  renameManager.clear();
  interactionManager.clear("test_reset");
  summaryAggregator.clear();
  __resetMessageMergerForTests();

  const aggregator = summaryAggregator as unknown as SummaryAggregatorPrivateState;
  aggregator.onCompleteCallback = null;
  aggregator.onPartialCallback = null;
  aggregator.onToolCallback = null;
  aggregator.onToolFileCallback = null;
  aggregator.onQuestionCallback = null;
  aggregator.onQuestionErrorCallback = null;
  aggregator.onThinkingCallback = null;
  aggregator.onTokensCallback = null;
  aggregator.onSessionCompactedCallback = null;
  aggregator.onSessionErrorCallback = null;
  aggregator.onPermissionCallback = null;
  aggregator.onSessionDiffCallback = null;
  aggregator.onFileChangeCallback = null;
  aggregator.bot = null;
  aggregator.chatId = null;
  aggregator.typingIndicatorEnabled = true;

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
    projectBranch: null,
    tokensUsed: 0,
    tokensLimit: 0,
    lastUpdated: 0,
    changedFiles: [],
  };

  __resetSessionDirectoryCacheForTests();

  if (
    "__resetLoggerForTests" in loggerModule &&
    typeof loggerModule.__resetLoggerForTests === "function"
  ) {
    loggerModule.__resetLoggerForTests();
  }
}
