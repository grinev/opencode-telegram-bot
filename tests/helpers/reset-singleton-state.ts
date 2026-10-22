export async function resetSingletonState(): Promise<void> {
  const [
    { stopEventListening },
    { __resetSessionDirectoryCacheForTests },
    { __resetMessageMergerForTests },
    { promptQueue },
    { __resetPromptQueueDispatchForTests },
    { promptHandover },
    { promptAttachment },
    { __resetStreamThrottleForTests },
    { telegramOutageNoticeService },
    { updateBusyWindowService },
    { __resetServerHealthStateForTests },
    modelSelectionModule,
    promptHandoverDeliveryModule,
    readyRefreshModule,
    configReloadModule,
    loggerModule,
    attachServiceModule,
  ] = await Promise.all([
    import("../../src/opencode/events.js"),
    import("../../src/app/services/session-cache-service.js"),
    import("../../src/bot/handlers/message-merger.js"),
    import("../../src/app/managers/prompt-queue-manager.js"),
    import("../../src/bot/handlers/prompt-queue-dispatch.js"),
    import("../../src/app/managers/prompt-handover-manager.js"),
    import("../../src/app/managers/prompt-attachment-manager.js"),
    import("../../src/bot/streaming/stream-throttle.js"),
    import("../../src/app/services/telegram-outage-notice-service.js"),
    import("../../src/app/services/update-busy-window-service.js"),
    import("../../src/opencode/server-health.js"),
    import("../../src/app/services/model-selection-service.js"),
    import("../../src/bot/handlers/prompt-handover.js"),
    import("../../src/opencode/ready-refresh.js"),
    import("../../src/app/services/config-reload-service.js"),
    import("../../src/utils/logger.js"),
    import("../../src/app/services/attach-service.js"),
  ]);

  stopEventListening();
  __resetStreamThrottleForTests();
  __resetMessageMergerForTests();
  promptQueue.__resetForTests();
  __resetPromptQueueDispatchForTests();
  promptHandover.__resetForTests();
  promptAttachment.__resetForTests();
  telegramOutageNoticeService.__resetForTests();
  updateBusyWindowService.__resetForTests();
  __resetSessionDirectoryCacheForTests();
  __resetServerHealthStateForTests();

  // Files that mock these modules may leave the reset out of the mock.
  if (
    "__resetModelCatalogCacheForTests" in modelSelectionModule &&
    typeof modelSelectionModule.__resetModelCatalogCacheForTests === "function"
  ) {
    modelSelectionModule.__resetModelCatalogCacheForTests();
  }

  if (
    "__resetPromptHandoverForTests" in promptHandoverDeliveryModule &&
    typeof promptHandoverDeliveryModule.__resetPromptHandoverForTests === "function"
  ) {
    promptHandoverDeliveryModule.__resetPromptHandoverForTests();
  }

  if (
    "__resetReadyRefreshForTests" in readyRefreshModule &&
    typeof readyRefreshModule.__resetReadyRefreshForTests === "function"
  ) {
    readyRefreshModule.__resetReadyRefreshForTests();
  }

  if (
    "__resetConfigReloadForTests" in configReloadModule &&
    typeof configReloadModule.__resetConfigReloadForTests === "function"
  ) {
    configReloadModule.__resetConfigReloadForTests();
  }

  if (
    "__resetLoggerForTests" in loggerModule &&
    typeof loggerModule.__resetLoggerForTests === "function"
  ) {
    loggerModule.__resetLoggerForTests();
  }

  if (
    "__resetAttachRestoreForTests" in attachServiceModule &&
    typeof attachServiceModule.__resetAttachRestoreForTests === "function"
  ) {
    attachServiceModule.__resetAttachRestoreForTests();
  }
}
