import { t } from "../../../i18n/index.js";
import { logger } from "../../../utils/logger.js";
import type { SubagentInfo, ToolInfo } from "../../../app/managers/summary-aggregation-manager.js";
import {
  formatCompactToolActivity,
  formatCompactToolInfo,
  formatToolInfo,
} from "../../../app/formatters/summary-formatter.js";
import { renderSubagentCard } from "../../../app/formatters/subagent-formatter.js";
import {
  RUNNING_ICON,
  appendDuration,
  appendDurationToFirstLine,
  formatDuration,
  formatDurationOverHours,
} from "../../../app/formatters/duration-formatter.js";
import {
  getDeleteCompactProgressOnFinish,
  getSendDiffFileAttachments,
} from "../../../app/stores/settings-store.js";
import type { RunningToolTick } from "../../streaming/running-tool-tracker.js";
import type { ToolStreamKey } from "../../streaming/tool-call-streamer.js";
import {
  TOOL_ELAPSED_MAX_TRACKING_HOURS,
  type CompactActivity,
  type SessionRuntimeState,
} from "../session-runtime-state.js";
import { closeCompactCardBeforeNextActivity } from "./assistant-response-handler.js";
import {
  SUBAGENT_STREAM_PREFIX,
  isCompactProgressMode,
  type EventHandlerBase,
  type EventHandlerDeps,
} from "./handler-context.js";

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;

type ToolActivityDeps = EventHandlerDeps<"summaryAggregator">;

function getLiveToolPrefix(callId: string): string {
  return `${RUNNING_ICON}${callId}`;
}

function getToolStreamKey(tool: string): ToolStreamKey {
  if (tool === "todowrite") {
    return "todo";
  }

  return "default";
}

function getSubagentStreamKey(cardId: string): ToolStreamKey {
  return `subagent:${cardId}`;
}

function formatElapsed(tick: Pick<RunningToolTick, "elapsedMs" | "isFinal">): string {
  return tick.isFinal
    ? formatDurationOverHours(TOOL_ELAPSED_MAX_TRACKING_HOURS)
    : formatDuration(tick.elapsedMs);
}

function prepareDocumentCaption(caption: string): string {
  const normalizedCaption = caption.trim();
  if (!normalizedCaption) {
    return "";
  }

  if (normalizedCaption.length <= TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH) {
    return normalizedCaption;
  }

  return `${normalizedCaption.slice(0, TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH - 3)}...`;
}

/** Launched in the background: the operation outlives the turn that started it. */
function isBackgroundTool(toolInfo: ToolInfo): boolean {
  return toolInfo.input?.background === true || toolInfo.metadata?.background === true;
}

/** Still being composed: OpenCode has not sent the call's arguments yet, so it is not shown. */
function isComposing(toolInfo: ToolInfo): boolean {
  return "status" in toolInfo.state && toolInfo.state.status === "pending";
}

function getCompactToolActivity(toolInfo: ToolInfo): string {
  if (toolInfo.tool === "task") {
    return t("progress.compact.task");
  }

  return (
    formatCompactToolActivity(toolInfo, 128) ?? formatCompactToolInfo(toolInfo, 128, toolInfo.tool)
  );
}

function pickCompactFallback(
  runtime: SessionRuntimeState,
  sessionId: string,
): CompactActivity | null {
  for (const callId of runtime.runningToolTracker.trackedCallIds(sessionId)) {
    const info = runtime.getRunningToolInfo(sessionId, callId);
    const activity = info && !isComposing(info) ? getCompactToolActivity(info) : null;
    if (activity) {
      return { callId, activity };
    }
  }

  return null;
}

function syncCompactToolActivity(
  runtime: SessionRuntimeState,
  sessionId: string,
  callId: string,
  activity: string,
): void {
  runtime.setCompactActivity(sessionId, { callId, activity });

  const tick = runtime.runningToolTracker.displayTick(callId);
  const text = tick ? appendDuration(activity, formatElapsed(tick)) : activity;

  runtime.compactProgressStreamer.updateActivity(sessionId, text);
}

function finalizeLiveToolLine(
  runtime: SessionRuntimeState,
  toolInfo: ToolInfo,
  durationMs?: number,
): void {
  const livePrefix = getLiveToolPrefix(toolInfo.callId);
  const streamKey = getToolStreamKey(toolInfo.tool);
  const message = formatToolInfo(toolInfo);
  if (!message) {
    return;
  }

  runtime.toolCallStreamer.replaceByPrefix(
    toolInfo.sessionId,
    livePrefix,
    durationMs === undefined ? message : appendDuration(message, formatDuration(durationMs)),
    streamKey,
  );
}

/** A finished background line no longer needs its message kept past the turn. */
function unpinLiveToolLine(runtime: SessionRuntimeState, toolInfo: ToolInfo): void {
  if (isBackgroundTool(toolInfo)) {
    runtime.toolCallStreamer.unpinEntry(
      toolInfo.sessionId,
      getLiveToolPrefix(toolInfo.callId),
      getToolStreamKey(toolInfo.tool),
    );
  }
}

async function renderSubagentCards(
  runtime: SessionRuntimeState,
  sessionId: string,
  subagents: SubagentInfo[],
): Promise<void> {
  const now = Date.now();
  const renderedCards = await Promise.all(
    subagents.map(async (subagent) => ({
      subagent,
      text: await renderSubagentCard(subagent, now),
    })),
  );
  for (const { subagent, text } of renderedCards) {
    if (!text) {
      continue;
    }

    const streamKey = getSubagentStreamKey(subagent.cardId);
    runtime.toolCallStreamer.replaceByPrefix(sessionId, SUBAGENT_STREAM_PREFIX, text, streamKey);

    // A background subagent's card keeps updating after its parent's turn ends.
    if (!subagent.background) {
      continue;
    }
    if (subagent.status === "pending" || subagent.status === "running") {
      runtime.toolCallStreamer.pinEntry(sessionId, SUBAGENT_STREAM_PREFIX, streamKey);
    } else {
      runtime.toolCallStreamer.unpinEntry(sessionId, SUBAGENT_STREAM_PREFIX, streamKey);
    }
  }
}

function handleRunningToolTick({ runtime, policy }: EventHandlerBase, tick: RunningToolTick): void {
  if (!policy.isForegroundSession(tick.sessionId)) {
    // The user moved to another session: what ran in the background here stays as it was.
    runtime.stopBackgroundOperations("session_not_current", tick.sessionId);
    return;
  }

  const elapsed = formatElapsed(tick);

  if (isCompactProgressMode()) {
    if (runtime.runningToolTracker.isBackground(tick.callId)) {
      const toolInfo = runtime.getRunningToolInfo(tick.sessionId, tick.callId);
      const activity = toolInfo ? getCompactToolActivity(toolInfo) : "";
      if (activity) {
        runtime.compactProgressStreamer.updateBackgroundOperation(
          tick.sessionId,
          tick.callId,
          appendDuration(activity, elapsed),
        );
      }
      if (runtime.runningToolTracker.isDetached(tick.callId)) {
        return;
      }
    }

    const cached = runtime.getCompactActivity(tick.sessionId);
    if (!cached || cached.callId !== tick.callId) {
      return;
    }

    runtime.compactProgressStreamer.updateActivity(
      tick.sessionId,
      appendDuration(cached.activity, elapsed),
    );
    return;
  }

  const toolInfo = runtime.getRunningToolInfo(tick.sessionId, tick.callId);
  if (!toolInfo || isComposing(toolInfo)) {
    return;
  }

  const message = formatToolInfo(toolInfo);
  if (!message) {
    return;
  }

  runtime.toolCallStreamer.replaceByPrefix(
    tick.sessionId,
    getLiveToolPrefix(tick.callId),
    `${RUNNING_ICON} ${appendDuration(message, elapsed)}`,
    getToolStreamKey(toolInfo.tool),
  );
}

async function refreshSubagentCards(
  { runtime, policy }: EventHandlerBase,
  sessionId: string,
): Promise<void> {
  if (isCompactProgressMode()) {
    return;
  }

  const subagents = runtime.getSubagentSnapshot(sessionId);
  if (!subagents) {
    return;
  }

  if (!policy.isForegroundSession(sessionId)) {
    runtime.stopBackgroundOperations("session_not_current", sessionId);
    return;
  }

  try {
    await renderSubagentCards(runtime, sessionId, subagents);
  } catch (err) {
    logger.error("Failed to refresh subagent activity for Telegram:", err);
  }
}

/** Tool lines, live timers, subagent cards, tool files and compact activity. */
export function registerToolActivityHandlers(deps: ToolActivityDeps): void {
  const { runtime, policy, summaryAggregator } = deps;

  runtime.setRunningToolHooks({
    onTick: (tick) => handleRunningToolTick(deps, tick),
    onHeartbeat: (sessionId) => {
      void refreshSubagentCards(deps, sessionId);
    },
  });

  summaryAggregator.setOnRootToolUpdate((toolInfo) => {
    const { sessionId, callId } = toolInfo;
    if (!policy.isForegroundSession(sessionId)) {
      return;
    }

    const status = "status" in toolInfo.state ? toolInfo.state.status : undefined;
    const compactMode = isCompactProgressMode();
    // In full mode the subagent card already reports what the child agent is
    // doing, so a live line for the task tool itself would duplicate it.
    const tracksElapsed = compactMode || toolInfo.tool !== "task";

    // A failed call is just as finished as a successful one: leaving it tracked
    // would keep its timer ticking for a tool that already stopped running.
    const isTerminal = status === "completed" || status === "error";
    const background = isBackgroundTool(toolInfo);
    // Read before the release below forgets the call. A background call no longer
    // tracked was stopped: its line or card stays as it was.
    const backgroundTracked = background && runtime.runningToolTracker.isBackground(callId);
    const backgroundDetached = background && runtime.runningToolTracker.isDetached(callId);
    // Its line is shown once its arguments are known; until then it is tracked
    // (the clock runs from here) but drawn nowhere.
    const composing = isComposing(toolInfo);
    const storedInfo = runtime.getRunningToolInfo(sessionId, callId);
    const failedWhileComposing = status === "error" && !!storedInfo && isComposing(storedInfo);

    if (compactMode && !isTerminal && !storedInfo) {
      closeCompactCardBeforeNextActivity(runtime, sessionId);
    }

    if (isTerminal) {
      if (tracksElapsed) {
        // Released here rather than in the tool callback: that callback returns
        // early in compact mode, which would leave the entry tracked forever.
        const durationMs = runtime.runningToolTracker.release(callId);

        if (!compactMode && status === "error") {
          finalizeLiveToolLine(runtime, toolInfo, durationMs);
          unpinLiveToolLine(runtime, toolInfo);
        }

        // Only a completed call reaches the tool callback, so only it has a
        // final line to carry the duration.
        if (durationMs !== undefined && !compactMode && status === "completed") {
          runtime.setCompletedToolDuration(sessionId, callId, durationMs);
        }
      }

      runtime.deleteRunningToolInfo(sessionId, callId);
    } else if (tracksElapsed) {
      runtime.runningToolTracker.track(sessionId, callId, background);
      runtime.setRunningToolInfo(toolInfo);
      if (composing) {
        // Nothing to draw yet: the bare tool name would flash before its command.
      } else if (!compactMode) {
        const message = formatToolInfo(toolInfo);
        if (message) {
          const tick = runtime.runningToolTracker.displayTick(callId);
          const streamKey = getToolStreamKey(toolInfo.tool);
          runtime.toolCallStreamer.replaceByPrefix(
            sessionId,
            getLiveToolPrefix(callId),
            `${RUNNING_ICON} ${tick ? appendDuration(message, formatElapsed(tick)) : message}`,
            streamKey,
          );
          if (background) {
            runtime.toolCallStreamer.pinEntry(sessionId, getLiveToolPrefix(callId), streamKey);
          }
        }
      } else if (background) {
        const activity = getCompactToolActivity(toolInfo);
        const tick = runtime.runningToolTracker.displayTick(callId);
        if (activity) {
          runtime.compactProgressStreamer.addBackgroundOperation(
            sessionId,
            callId,
            tick ? appendDuration(activity, formatElapsed(tick)) : activity,
          );
        }
      }
    }

    if (!compactMode) {
      return;
    }

    if (background && isTerminal) {
      // Counted on the card it started in, which closes with it once parked.
      void runtime.compactProgressStreamer
        .endBackgroundOperation(sessionId, callId, getDeleteCompactProgressOnFinish())
        .catch((error) => {
          logger.error("[Bot] Failed to close the progress card of a background operation", error);
        });
      if (!backgroundTracked || backgroundDetached) {
        return;
      }
    }

    if (isTerminal) {
      const fallback = pickCompactFallback(runtime, sessionId);
      if (fallback) {
        syncCompactToolActivity(runtime, sessionId, fallback.callId, fallback.activity);
      } else if (!runtime.runningToolTracker.newestCallId(sessionId) && !failedWhileComposing) {
        const activity = getCompactToolActivity(toolInfo);
        if (activity) {
          runtime.setCompactActivity(sessionId, { callId, activity });
          runtime.compactProgressStreamer.updateActivity(sessionId, activity);
        }
      }
    } else if (!composing && runtime.runningToolTracker.newestCallId(sessionId) === callId) {
      const activity = getCompactToolActivity(toolInfo);
      if (activity) {
        syncCompactToolActivity(runtime, sessionId, callId, activity);
      }
    }

    if (status === "completed" && !background) {
      runtime.compactProgressStreamer.addToolCall(sessionId, callId);
    }
  });

  summaryAggregator.setOnTool(async (toolInfo) => {
    if (!policy.getDestination(toolInfo.sessionId)) {
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    if (!policy.isForegroundSession(toolInfo.sessionId)) {
      return;
    }

    if (isCompactProgressMode()) {
      return;
    }

    const shouldSendToolFileAttachment =
      toolInfo.hasFileAttachment &&
      getSendDiffFileAttachments() &&
      (toolInfo.tool === "write" || toolInfo.tool === "edit" || toolInfo.tool === "apply_patch");

    if (shouldSendToolFileAttachment || toolInfo.tool === "task") {
      return;
    }

    try {
      const message = formatToolInfo(toolInfo);
      if (message) {
        const durationMs = runtime.takeCompletedToolDuration(toolInfo.sessionId, toolInfo.callId);
        // A patch lists one line per file: the duration stays on the line that was running
        const withDuration =
          toolInfo.tool === "apply_patch" ? appendDurationToFirstLine : appendDuration;
        runtime.toolCallStreamer.replaceByPrefix(
          toolInfo.sessionId,
          getLiveToolPrefix(toolInfo.callId),
          durationMs === undefined ? message : withDuration(message, formatDuration(durationMs)),
          getToolStreamKey(toolInfo.tool),
        );
        unpinLiveToolLine(runtime, toolInfo);
      }
    } catch (err) {
      logger.error("Failed to send tool notification to Telegram:", err);
    }
  });

  summaryAggregator.setOnSubagent(async (sessionId, subagents) => {
    if (!policy.getDestination(sessionId)) {
      return;
    }

    if (isCompactProgressMode()) {
      return;
    }

    if (!policy.isForegroundSession(sessionId)) {
      return;
    }

    runtime.setSubagentSnapshot(sessionId, subagents);
    runtime.runningToolTracker.setHeartbeatActive(
      sessionId,
      subagents.some((subagent) => subagent.status === "pending" || subagent.status === "running"),
    );

    try {
      await renderSubagentCards(runtime, sessionId, subagents);
    } catch (err) {
      logger.error("Failed to render subagent activity for Telegram:", err);
    }
  });

  summaryAggregator.setOnToolFile(async (fileInfo) => {
    if (!policy.getDestination(fileInfo.sessionId)) {
      logger.error("Bot or chat ID not available for sending file");
      return;
    }

    if (!policy.isForegroundSession(fileInfo.sessionId)) {
      return;
    }

    if (isCompactProgressMode()) {
      return;
    }

    if (!getSendDiffFileAttachments()) {
      return;
    }

    try {
      await runtime.letOutRepliesBeforeDocument(fileInfo.sessionId);
      const durationMs = runtime.takeCompletedToolDuration(fileInfo.sessionId, fileInfo.callId);
      const livePrefix = getLiveToolPrefix(fileInfo.callId);
      const streamKey = getToolStreamKey(fileInfo.tool);
      // A file whose document was too big keeps its line where the running line was
      const textLines = fileInfo.files.flatMap(({ fileData, line }) =>
        !fileData && line ? [line] : [],
      );
      if (textLines.length > 0) {
        const text = textLines.join("\n");
        const firstFileIsText = !fileInfo.files[0]?.fileData;
        runtime.toolCallStreamer.replaceByPrefix(
          fileInfo.sessionId,
          livePrefix,
          firstFileIsText && durationMs !== undefined
            ? appendDurationToFirstLine(text, formatDuration(durationMs))
            : text,
          streamKey,
        );
        unpinLiveToolLine(runtime, fileInfo);
      } else {
        runtime.toolCallStreamer.removeByPrefix(fileInfo.sessionId, livePrefix, streamKey, true);
      }
      runtime.toolCallStreamer.beginDocumentBoundary(fileInfo.sessionId);
      await runtime.toolCallStreamer.flushSession(fileInfo.sessionId, "tool_file_boundary");

      const toolMessage = formatToolInfo(fileInfo);
      for (const { fileData, line } of fileInfo.files) {
        if (!fileData) {
          continue;
        }
        runtime.toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
          ...fileData,
          caption: prepareDocumentCaption(line || toolMessage || fileData.caption),
        });
      }
      await runtime.toolMessageBatcher.flushSession(fileInfo.sessionId, "tool_file_boundary");
    } catch (err) {
      logger.error("Failed to send file to Telegram:", err);
    } finally {
      runtime.toolCallStreamer.endDocumentBoundary(fileInfo.sessionId);
    }
  });
}
