export async function resetSingletonState(): Promise<void> {
  const [
    { stopEventListening },
    { __resetSessionDirectoryCacheForTests },
    { __resetMessageMergerForTests },
    { promptQueue },
    { __resetPromptQueueDispatchForTests },
    { promptAttachment },
    { __resetStreamThrottleForTests },
    { telegramOutageNoticeService },
    { __resetServerHealthStateForTests },
    loggerModule,
  ] = await Promise.all([
    import("../../src/opencode/events.js"),
    import("../../src/app/services/session-cache-service.js"),
    import("../../src/bot/handlers/message-merger.js"),
    import("../../src/app/managers/prompt-queue-manager.js"),
    import("../../src/bot/handlers/prompt-queue-dispatch.js"),
    import("../../src/app/managers/prompt-attachment-manager.js"),
    import("../../src/bot/streaming/stream-throttle.js"),
    import("../../src/app/services/telegram-outage-notice-service.js"),
    import("../../src/opencode/server-health.js"),
    import("../../src/utils/logger.js"),
  ]);

  stopEventListening();
  __resetStreamThrottleForTests();
  __resetMessageMergerForTests();
  promptQueue.__resetForTests();
  __resetPromptQueueDispatchForTests();
  promptAttachment.__resetForTests();
  telegramOutageNoticeService.__resetForTests();
  __resetSessionDirectoryCacheForTests();
  __resetServerHealthStateForTests();

  if (
    "__resetLoggerForTests" in loggerModule &&
    typeof loggerModule.__resetLoggerForTests === "function"
  ) {
    loggerModule.__resetLoggerForTests();
  }
}
