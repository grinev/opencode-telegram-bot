import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedScheduledTaskDelivery } from "../../../src/app/types/scheduled-task.js";

const sendBotTextMock = vi.fn();

function createDelivery(
  overrides: Partial<QueuedScheduledTaskDelivery> = {},
): QueuedScheduledTaskDelivery {
  return {
    taskId: "task-1",
    scheduleSummary: "Every hour",
    prompt: "Send report",
    runAt: "2026-03-16T10:00:00.000Z",
    status: "success",
    notificationText: "✅ Scheduled task completed: Send report",
    resultText: "All good",
    footerText: "🛠️ Build · 🤖 openai/gpt-5 · 🕒 1m",
    ...overrides,
  };
}

async function createSender(scheduledTaskNotificationsSilent: boolean) {
  vi.resetModules();
  vi.doMock("../../../src/config.js", () => ({
    config: {
      bot: {
        messageFormatMode: "markdown",
        scheduledTaskNotificationsSilent,
      },
    },
  }));
  vi.doMock("../../../src/bot/messages/telegram-text.js", () => ({
    sendBotText: sendBotTextMock,
  }));

  const { createScheduledTaskDeliverySender } = await import(
    "../../../src/bot/messages/scheduled-task-delivery.js"
  );

  return createScheduledTaskDeliverySender({ sendMessage: vi.fn() } as never, 777);
}

describe("bot/messages/scheduled-task-delivery", () => {
  beforeEach(() => {
    sendBotTextMock.mockReset();
  });

  it("keeps existing success result suppression when a footer is sent", async () => {
    const sender = await createSender(false);

    await sender.send(createDelivery());

    expect(sendBotTextMock).toHaveBeenCalledTimes(2);
    expect(sendBotTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chatId: 777,
        format: "markdown_v2",
        options: { disable_notification: true },
      }),
    );
    expect(sendBotTextMock).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({
        options: { disable_notification: true },
      }),
    );
  });

  it("marks success body and footer messages silent when scheduled task notifications are disabled", async () => {
    const sender = await createSender(true);

    await sender.send(createDelivery());

    expect(sendBotTextMock).toHaveBeenCalledTimes(2);
    expect(sendBotTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chatId: 777,
        format: "markdown_v2",
        options: { disable_notification: true },
      }),
    );
    expect(sendBotTextMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chatId: 777,
        format: "raw",
        options: { disable_notification: true },
      }),
    );
  });

  it("marks scheduled task error notifications silent when configured", async () => {
    const sender = await createSender(true);

    await sender.send(
      createDelivery({
        status: "error",
        notificationText: "❌ Scheduled task failed: Task failed",
        resultText: undefined,
        footerText: undefined,
      }),
    );

    expect(sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        format: "raw",
        text: "❌ Scheduled task failed: Task failed",
        options: { disable_notification: true },
      }),
    );
  });
});
