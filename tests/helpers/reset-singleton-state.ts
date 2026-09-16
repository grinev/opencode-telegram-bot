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
}

interface KeyboardManagerPrivateState {
  state: null;
  api: null;
  chatId: null;
  lastUpdateTime: number;
}

export async function resetSingletonState(): Promise<void> {
  const [
    { permissionManager },
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
    { telegramOutageNoticeService },
    loggerModule,
  ] = await Promise.all([
    import("../../src/app/managers/permission-manager.js"),
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
    import("../../src/app/services/telegram-outage-notice-service.js"),
    import("../../src/utils/logger.js"),
  ]);

  stopEventListening();
  __resetStreamThrottleForTests();
  // Test files that mock the interaction managers supply their own stubs,
  // which have nothing to reset.
  if (typeof interactionManager.__resetForTests === "function") {
    interactionManager.__resetForTests();
  }
  if (typeof permissionManager.__resetForTests === "function") {
    permissionManager.__resetForTests();
  }
  summaryAggregator.clear();
  __resetMessageMergerForTests();
  promptQueue.__resetForTests();
  __resetPromptQueueDispatchForTests();
  promptAttachment.__resetForTests();
  telegramOutageNoticeService.__resetForTests();

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
