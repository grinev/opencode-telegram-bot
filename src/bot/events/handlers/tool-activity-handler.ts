import { logger } from "../../../utils/logger.js";
import {
  outlivesParentTurn,
  type SubagentInfo,
  type ToolInfo,
} from "../../../app/managers/summary-aggregation-manager.js";
import {
  buildTodoSnapshot,
  formatCompactToolActivity,
  formatCompactToolInfo,
  formatRunningTaskLine,
  formatToolInfo,
  getTodoSnapshot,
  type TodoSnapshot,
} from "../../../app/formatters/summary-formatter.js";
import { renderSubagentCard } from "../../../app/formatters/subagent-formatter.js";
import { countToolCall } from "../../../app/formatters/compact-summary-formatter.js";
import {
  RUNNING_ICON,
  TOOL_ELAPSED_THRESHOLD_MS,
  appendDuration,
  appendDurationToFirstLine,
  bucketElapsedMs,
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
  isFullProgressMode,
  isMinimalProgressMode,
  type EventHandlerBase,
  type EventHandlerDeps,
} from "./handler-context.js";

const TELEGRAM_DOCUMENT_CAPTION_MAX_LENGTH = 1024;

type ToolActivityDeps = EventHandlerDeps<"summaryAggregator">;

function getLiveToolPrefix(callId: string): string {
  return `${RUNNING_ICON}${callId}`;
}

function getSubagentStreamKey(cardId: string): ToolStreamKey {
  return `subagent:${cardId}`;
}

/**
 * The line a tool call draws: a todo call's snapshot text with its counts, anything else the
 * ordinary tool line. A todo call whose list is not known yet has no line at all.
 */
function getToolLine(toolInfo: ToolInfo): { text: string; todo?: TodoSnapshot } | null {
  if (toolInfo.tool === "todowrite") {
    const snapshot = getTodoSnapshot(toolInfo);
    return snapshot ? { text: snapshot.text, todo: snapshot } : null;
  }

  const message = formatToolInfo(toolInfo);
  return message ? { text: message } : null;
}

/** A todo snapshot goes to its own message at the bottom; every other line to the tool stream. */
function replaceToolLine(
  deps: EventHandlerBase,
  toolInfo: ToolInfo,
  text: string,
  todo: TodoSnapshot | undefined,
): void {
  if (todo) {
    const destination = deps.policy.getDestination(toolInfo.sessionId);
    if (!destination) {
      return;
    }

    deps.runtime.todoSnapshots.track(toolInfo.sessionId, toolInfo.callId, destination.chatId, {
      text,
      done: todo.done,
      total: todo.total,
    });
    return;
  }

  deps.runtime.toolCallStreamer.replaceByPrefix(
    toolInfo.sessionId,
    getLiveToolPrefix(toolInfo.callId),
    text,
  );
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
    return formatRunningTaskLine(toolInfo.input);
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

  runtime.compactProgressStreamer.updateActivity(sessionId, text, callId);
}

/** A todo call cut short has no result list: finish the list it was running on. */
function getInterruptedTodoLine(
  deps: EventHandlerBase,
  toolInfo: ToolInfo,
): { text: string; todo?: TodoSnapshot } | null {
  if (toolInfo.tool !== "todowrite") {
    return null;
  }

  const running = deps.runtime.getRunningToolInfo(toolInfo.sessionId, toolInfo.callId);
  const snapshot = buildTodoSnapshot(running?.input?.todos);
  return snapshot ? { text: snapshot.text, todo: snapshot } : null;
}

function finalizeLiveToolLine(
  deps: EventHandlerBase,
  toolInfo: ToolInfo,
  durationMs?: number,
): void {
  const line = getToolLine(toolInfo) ?? getInterruptedTodoLine(deps, toolInfo);
  if (!line) {
    return;
  }

  replaceToolLine(
    deps,
    toolInfo,
    durationMs === undefined
      ? line.text
      : appendDuration(line.text, formatDuration(durationMs)),
    line.todo,
  );
}

/** A finished background line no longer needs its message kept past the turn. */
function unpinLiveToolLine(runtime: SessionRuntimeState, toolInfo: ToolInfo): void {
  if (isBackgroundTool(toolInfo)) {
    runtime.toolCallStreamer.unpinEntry(toolInfo.sessionId, getLiveToolPrefix(toolInfo.callId));
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

    // A background subagent's card keeps updating after its parent's turn ends; so does a
    // card waiting on a nested subagent it launched in the background.
    if (
      outlivesParentTurn(subagent) &&
      (subagent.status === "pending" || subagent.status === "running")
    ) {
      runtime.toolCallStreamer.pinEntry(sessionId, SUBAGENT_STREAM_PREFIX, streamKey);
    } else {
      runtime.toolCallStreamer.unpinEntry(sessionId, SUBAGENT_STREAM_PREFIX, streamKey);
    }
  }
}

function handleRunningToolTick(deps: EventHandlerBase, tick: RunningToolTick): void {
  if (isMinimalProgressMode()) return;
  const { runtime, policy } = deps;
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
      tick.callId,
    );
    return;
  }

  const toolInfo = runtime.getRunningToolInfo(tick.sessionId, tick.callId);
  if (!toolInfo || isComposing(toolInfo)) {
    return;
  }

  const line = getToolLine(toolInfo);
  if (!line) {
    return;
  }

  replaceToolLine(
    deps,
    toolInfo,
    `${RUNNING_ICON} ${appendDuration(line.text, elapsed)}`,
    line.todo,
  );
}

function updateCompactNestedTasks(
  runtime: SessionRuntimeState,
  sessionId: string,
  subagents: SubagentInfo[],
): void {
  for (const subagent of subagents) {
    const { taskCallId, backgroundLaunch } = subagent;
    if (!taskCallId) continue;
    const progress = runtime.compactProgressStreamer;
    if (backgroundLaunch) {
      const elapsedMs = Date.now() - backgroundLaunch.startedAt;
      const activity = formatRunningTaskLine({ description: backgroundLaunch.description });
      progress.updateNestedBackgroundOperation(
        sessionId,
        taskCallId,
        elapsedMs >= TOOL_ELAPSED_THRESHOLD_MS
          ? appendDuration(activity, formatDuration(bucketElapsedMs(elapsedMs)))
          : activity,
      );
    } else {
      const finished = subagent.status !== "pending" && subagent.status !== "running";
      void progress
        .endNestedBackgroundOperation(
          sessionId,
          taskCallId,
          finished ? countToolCall({ tool: "task" }) : undefined,
          getDeleteCompactProgressOnFinish(),
        )
        .catch((error) => logger.error("[Bot] Failed to finish nested task progress:", error));
    }
  }
}

async function refreshSubagentCards(
  { runtime, policy }: EventHandlerBase,
  sessionId: string,
): Promise<void> {
  const compact = isCompactProgressMode();
  if (!compact && !isFullProgressMode()) return;

  const subagents = runtime.getSubagentSnapshot(sessionId);
  if (!subagents) {
    return;
  }

  if (!policy.isForegroundSession(sessionId)) {
    runtime.stopBackgroundOperations("session_not_current", sessionId);
    return;
  }

  if (compact) {
    updateCompactNestedTasks(runtime, sessionId, subagents);
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
    const fullMode = isFullProgressMode();
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
    const detached = runtime.runningToolTracker.isDetached(callId);
    // Its line is shown once its arguments are known; until then it is tracked
    // (the clock runs from here) but drawn nowhere.
    const composing = isComposing(toolInfo);
    const storedInfo = runtime.getRunningToolInfo(sessionId, callId);
    const failedWhileComposing = status === "error" && !!storedInfo && isComposing(storedInfo);

    const isBackgroundTaskReturn = toolInfo.tool === "task" && toolInfo.metadata?.background === true;
    if (
      !fullMode &&
      !compactMode &&
      status === "running" &&
      !composing &&
      !backgroundTracked &&
      !isBackgroundTaskReturn
    ) {
      runtime.noteMinimalWork(sessionId, { callId });
    }

    const progress = runtime.compactProgressStreamer;
    if (compactMode && !isTerminal && !storedInfo && !progress.hasToolCall(sessionId, callId)) {
      closeCompactCardBeforeNextActivity(runtime, sessionId);
      if (toolInfo.tool === "task" || background) {
        progress.registerToolCall(sessionId, callId, toolInfo.tool === "task");
      }
    }

    if (isTerminal) {
      if (tracksElapsed) {
        // Released here rather than in the tool callback: that callback returns
        // early in compact mode, which would leave the entry tracked forever.
        const durationMs = runtime.runningToolTracker.release(callId);

        if (fullMode && status === "error") {
          finalizeLiveToolLine(deps, toolInfo, durationMs);
          unpinLiveToolLine(runtime, toolInfo);
        }

        // Only a completed call reaches the tool callback, so only it has a
        // final line to carry the duration.
        if (durationMs !== undefined && fullMode && status === "completed") {
          runtime.setCompletedToolDuration(sessionId, callId, durationMs);
        }
      }

      runtime.deleteRunningToolInfo(sessionId, callId);
    } else if (tracksElapsed) {
      runtime.runningToolTracker.track(sessionId, callId, background);
      runtime.setRunningToolInfo(toolInfo);
      if (composing) {
        // Nothing to draw yet: the bare tool name would flash before its command.
      } else if (fullMode) {
        const line = getToolLine(toolInfo);
        if (line) {
          const tick = runtime.runningToolTracker.displayTick(callId);
          replaceToolLine(
            deps,
            toolInfo,
            `${RUNNING_ICON} ${tick ? appendDuration(line.text, formatElapsed(tick)) : line.text}`,
            line.todo,
          );
          if (background && !line.todo) {
            runtime.toolCallStreamer.pinEntry(sessionId, getLiveToolPrefix(callId));
          }
        }
      } else if (compactMode && background) {
        const activity = getCompactToolActivity(toolInfo);
        const tick = runtime.runningToolTracker.displayTick(callId);
        if (activity) {
          progress.addBackgroundOperation(
            sessionId,
            callId,
            tick ? appendDuration(activity, formatElapsed(tick)) : activity,
          );
          if (progress.isToolCallParked(sessionId, callId)) {
            runtime.runningToolTracker.detach([callId]);
          }
        }
      }
    }

    if (!compactMode) {
      return;
    }

    if (background && isTerminal) {
      // Counted on the card it started in, which closes with it once parked.
      void runtime.compactProgressStreamer
        .endBackgroundOperation(
          sessionId,
          callId,
          countToolCall(toolInfo),
          getDeleteCompactProgressOnFinish(),
        )
        .catch((error) => {
          logger.error("[Bot] Failed to close the progress card of a background operation", error);
        });
      if (!backgroundTracked || detached) {
        return;
      }
    }

    // A failed call counts as finished work only if it was seen running: one that
    // failed while composing, or after the bot already ended it, was never shown.
    const seenFailing = status === "error" && !!storedInfo && !failedWhileComposing;
    const ownsTask = toolInfo.tool !== "task" || progress.hasToolCall(sessionId, callId);
    const shouldCount = (status === "completed" || seenFailing) && !background && ownsTask;

    if (!ownsTask || detached || progress.isToolCallParked(sessionId, callId)) {
      // Still count a root task on its parked message if a nested launch holds it.
      if (shouldCount) progress.addToolCall(sessionId, callId, countToolCall(toolInfo));
      return;
    }

    if (isTerminal) {
      const fallback = pickCompactFallback(runtime, sessionId);
      if (fallback) {
        syncCompactToolActivity(runtime, sessionId, fallback.callId, fallback.activity);
      } else if (!runtime.runningToolTracker.newestCallId(sessionId) && !failedWhileComposing) {
        const activity = getCompactToolActivity(toolInfo);
        if (activity) {
          runtime.setCompactActivity(sessionId, { callId, activity });
          progress.updateActivity(sessionId, activity, callId);
        }
      }
    } else if (!composing && runtime.runningToolTracker.newestCallId(sessionId) === callId) {
      const activity = getCompactToolActivity(toolInfo);
      if (activity) {
        syncCompactToolActivity(runtime, sessionId, callId, activity);
      }
    }

    if (shouldCount) progress.addToolCall(sessionId, callId, countToolCall(toolInfo));
  });

  summaryAggregator.setOnTool(async (toolInfo) => {
    if (!policy.getDestination(toolInfo.sessionId)) {
      logger.error("Bot or chat ID not available for sending tool notification");
      return;
    }

    if (!policy.isForegroundSession(toolInfo.sessionId)) {
      return;
    }

    if (!isFullProgressMode()) {
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
      const line = getToolLine(toolInfo);
      if (line) {
        const durationMs = runtime.takeCompletedToolDuration(toolInfo.sessionId, toolInfo.callId);
        // A patch lists one line per file: the duration stays on the line that was running
        const withDuration =
          toolInfo.tool === "apply_patch" ? appendDurationToFirstLine : appendDuration;
        replaceToolLine(
          deps,
          toolInfo,
          durationMs === undefined ? line.text : withDuration(line.text, formatDuration(durationMs)),
          line.todo,
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

    if (!policy.isForegroundSession(sessionId)) {
      return;
    }
    if (isCompactProgressMode()) {
      const active = subagents.filter((subagent) => subagent.taskCallId && subagent.backgroundLaunch);
      runtime.setSubagentSnapshot(sessionId, active);
      runtime.runningToolTracker.setHeartbeatActive(sessionId, active.length > 0);
      updateCompactNestedTasks(runtime, sessionId, subagents);
      return;
    }
    if (!isFullProgressMode()) {
      if (isMinimalProgressMode()) {
        for (const subagent of subagents) {
          if (subagent.status === "running" && !outlivesParentTurn(subagent)) {
            runtime.noteMinimalWork(sessionId, { callId: subagent.cardId });
          }
        }
      }
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

    if (!isFullProgressMode()) {
      return;
    }

    if (!getSendDiffFileAttachments()) {
      return;
    }

    try {
      await runtime.letOutRepliesBeforeDocument(fileInfo.sessionId);
      const durationMs = runtime.takeCompletedToolDuration(fileInfo.sessionId, fileInfo.callId);
      const livePrefix = getLiveToolPrefix(fileInfo.callId);
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
        );
        unpinLiveToolLine(runtime, fileInfo);
      } else {
        runtime.toolCallStreamer.removeByPrefix(fileInfo.sessionId, livePrefix, undefined, true);
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
