import type { Context, NextFunction } from "grammy";

interface PendingWaiter {
  messageId: number;
  resolve: () => void;
}

class TelegramInputOrderManager {
  private readonly pendingByChat = new Map<number, Set<number>>();
  private readonly waitersByChat = new Map<number, PendingWaiter[]>();

  defer(chatId: number, messageId: number): void {
    const pending = this.pendingByChat.get(chatId) ?? new Set<number>();
    pending.add(messageId);
    this.pendingByChat.set(chatId, pending);
  }

  release(chatId: number, messageId: number): void {
    const pending = this.pendingByChat.get(chatId);
    pending?.delete(messageId);
    if (pending?.size === 0) {
      this.pendingByChat.delete(chatId);
    }
    this.resolveReadyWaiters(chatId);
  }

  waitForEarlier(chatId: number, messageId: number): Promise<void> {
    if (!this.hasEarlierPending(chatId, messageId)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const waiters = this.waitersByChat.get(chatId) ?? [];
      waiters.push({ messageId, resolve });
      this.waitersByChat.set(chatId, waiters);
    });
  }

  __resetForTests(): void {
    for (const waiters of this.waitersByChat.values()) {
      for (const waiter of waiters) {
        waiter.resolve();
      }
    }
    this.pendingByChat.clear();
    this.waitersByChat.clear();
  }

  private hasEarlierPending(chatId: number, messageId: number): boolean {
    return Array.from(this.pendingByChat.get(chatId) ?? []).some(
      (pendingMessageId) => pendingMessageId < messageId,
    );
  }

  private resolveReadyWaiters(chatId: number): void {
    const waiters = this.waitersByChat.get(chatId);
    if (!waiters) {
      return;
    }

    const blocked: PendingWaiter[] = [];
    for (const waiter of waiters) {
      if (this.hasEarlierPending(chatId, waiter.messageId)) {
        blocked.push(waiter);
      } else {
        waiter.resolve();
      }
    }

    if (blocked.length > 0) {
      this.waitersByChat.set(chatId, blocked);
    } else {
      this.waitersByChat.delete(chatId);
    }
  }
}

export const telegramInputOrderManager = new TelegramInputOrderManager();

export async function telegramInputOrderMiddleware(
  ctx: Context,
  next: NextFunction,
): Promise<void> {
  const message = ctx.message;
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    await next();
    return;
  }

  if (!message) {
    await next();
    return;
  }

  if (message.media_group_id) {
    await next();
    return;
  }

  await telegramInputOrderManager.waitForEarlier(chatId, message.message_id);
  await next();
}
