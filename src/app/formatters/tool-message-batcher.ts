import type { CodeFileData } from "./summary-formatter.js";
import { logger } from "../../utils/logger.js";

type SendTextCallback = (sessionId: string, text: string) => Promise<void>;
type SendFileCallback = (sessionId: string, fileData: CodeFileData) => Promise<void>;

interface ToolMessageBatcherOptions {
  sendText: SendTextCallback;
  sendFile: SendFileCallback;
}

export class ToolMessageBatcher {
  private readonly sendText: SendTextCallback;
  private readonly sendFile: SendFileCallback;
  private readonly sessionTasks: Map<string, Promise<void>> = new Map();
  private generation = 0;

  constructor(options: ToolMessageBatcherOptions) {
    this.sendText = options.sendText;
    this.sendFile = options.sendFile;
  }

  enqueue(sessionId: string, message: string): void {
    this.sendTextNow(sessionId, message, "enqueue");
  }

  sendTextNow(sessionId: string, message: string, reason: string): void {
    const normalizedMessage = message.trim();
    if (!sessionId || normalizedMessage.length === 0) {
      return;
    }

    const expectedGeneration = this.generation;
    logger.debug(`[ToolBatcher] Sending text message: session=${sessionId}, reason=${reason}`);
    void this.enqueueTask(sessionId, () =>
      this.sendTextSafe(sessionId, normalizedMessage, reason, expectedGeneration),
    );
  }

  enqueueUniqueByPrefix(sessionId: string, message: string, prefix: string): void {
    void prefix;
    this.sendTextNow(sessionId, message, "enqueue_unique_by_prefix");
  }

  enqueueFile(sessionId: string, fileData: CodeFileData): void {
    if (!sessionId) {
      return;
    }

    const expectedGeneration = this.generation;
    logger.debug(`[ToolBatcher] Sending file message: session=${sessionId}`);
    void this.enqueueTask(sessionId, () =>
      this.sendFileSafe(sessionId, fileData, "enqueue_file", expectedGeneration),
    );
  }

  async flushSession(sessionId: string, reason: string): Promise<void> {
    void reason;
    await (this.sessionTasks.get(sessionId) ?? Promise.resolve());
  }

  async flushAll(reason: string): Promise<void> {
    void reason;
    for (const task of this.sessionTasks.values()) {
      await task;
    }
  }

  clearSession(sessionId: string, reason: string): void {
    this.generation++;
    logger.debug(`[ToolBatcher] Cleared session sends: session=${sessionId}, reason=${reason}`);
  }

  clearAll(reason: string): void {
    this.generation++;
    logger.debug(`[ToolBatcher] Cleared all pending tool sends: reason=${reason}`);
  }

  private enqueueTask(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previousTask = this.sessionTasks.get(sessionId) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.sessionTasks.get(sessionId) === nextTask) {
          this.sessionTasks.delete(sessionId);
        }
      });

    this.sessionTasks.set(sessionId, nextTask);
    return nextTask;
  }

  private async sendTextSafe(
    sessionId: string,
    text: string,
    reason: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (this.generation !== expectedGeneration) {
      logger.debug(
        `[ToolBatcher] Dropping stale tool text message: session=${sessionId}, reason=${reason}`,
      );
      return;
    }

    try {
      await this.sendText(sessionId, text);
    } catch (err) {
      logger.error(
        `[ToolBatcher] Failed to send tool text message: session=${sessionId}, reason=${reason}`,
        err,
      );
    }
  }

  private async sendFileSafe(
    sessionId: string,
    fileData: CodeFileData,
    reason: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (this.generation !== expectedGeneration) {
      logger.debug(
        `[ToolBatcher] Dropping stale tool file message: session=${sessionId}, reason=${reason}`,
      );
      return;
    }

    try {
      await this.sendFile(sessionId, fileData);
    } catch (err) {
      logger.error(
        `[ToolBatcher] Failed to send tool file message: session=${sessionId}, reason=${reason}`,
        err,
      );
    }
  }
}
