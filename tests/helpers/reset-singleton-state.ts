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
  onPermissionRepliedCallback: null;
  onSessionDiffCallback: null;
  onFileChangeCallback: null;
  bot: null;
  chatId: null;
  typingIndicatorEnabled: boolean;
  processedToolStates: Set<string>;
}

interface KeyboardManagerPrivateState {
  state: null;
  api: null;
  chatId: null;
  lastUpdateTime: number;
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
    { promptQueue },
    { __resetPromptQueueDispatchForTests },
    { promptAttachment },
    { __resetStreamThrottleForTests },
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
    import("../../src/app/managers/prompt-queue-manager.js"),
    import("../../src/bot/handlers/prompt-queue-dispatch.js"),
    import("../../src/app/managers/prompt-attachment-manager.js"),
    import("../../src/bot/streaming/stream-throttle.js"),
    import("../../src/utils/logger.js"),
  ]);

  stopEventListening();
  __resetStreamThrottleForTests();
  questionManager.clear();
  permissionManager.clear();
  renameManager.clear();
  interactionManager.clear("test_reset");
  summaryAggregator.clear();
  __resetMessageMergerForTests();
  promptQueue.__resetForTests();
  __resetPromptQueueDispatchForTests();
  promptAttachment.__resetForTests();

  // The queue/merger/attachment modules pull in prompt.ts → session-service
  // and friends. When the current test mocks any module in that chain, bun's
  // mock.module replaces the whole module and the import link can fail — so
  // load each one separately and treat failure as "nothing to reset" (same
  // spirit as the logger below).
  type ResetModule = { __resetForTests?: () => void; __resetMessageMergerForTests?: () => void };
  const resettable = [
    ["../../src/bot/handlers/message-merger.js", "__resetMessageMergerForTests"],
    ["../../src/app/managers/prompt-queue-manager.js", "__resetForTests"],
    ["../../src/bot/handlers/prompt-queue-dispatch.js", "__resetPromptQueueDispatchForTests"],
    ["../../src/app/managers/prompt-attachment-manager.js", "__resetForTests"],
  ] as const;
  for (const [specifier, resetFn] of resettable) {
    try {
      const mod = (await import(specifier)) as ResetModule;
      const fn = mod[resetFn];
      if (typeof fn === "function") {
        fn();
      }
    } catch {
      // module graph mocked away — nothing to reset
    }
  }

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
  aggregator.onPermissionRepliedCallback = null;
  aggregator.onSessionDiffCallback = null;
  aggregator.onFileChangeCallback = null;
  aggregator.bot = null;
  aggregator.chatId = null;
  aggregator.typingIndicatorEnabled = true;
  // clear() intentionally preserves processedToolStates (replay protection);
  // tests need it empty so fixed call IDs cannot leak between tests.
  // Guarded: files that mock the aggregator module supply a stub without it.
  if (aggregator.processedToolStates instanceof Set) {
    aggregator.processedToolStates.clear();
  }

  const keyboard = keyboardManager as unknown as KeyboardManagerPrivateState;
  keyboard.state = null;
  keyboard.api = null;
  keyboard.chatId = null;
  keyboard.lastUpdateTime = 0;

  // Test files that mock the pinned manager module supply their own stub,
  // which has nothing to reset.
  if (typeof pinnedMessageManager.__resetForTests === "function") {
    pinnedMessageManager.__resetForTests();
  }

  __resetSessionDirectoryCacheForTests();

  if (
    "__resetLoggerForTests" in loggerModule &&
    typeof loggerModule.__resetLoggerForTests === "function"
  ) {
    loggerModule.__resetLoggerForTests();
  }
}
