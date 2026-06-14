import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedScheduledTaskDelivery } from "../../../src/app/types/scheduled-task.js";

const mocked = vi.hoisted(() => ({
  messageFormatMode: "markdown" as "markdown" | "raw",
  scheduledTaskNotificationsSilent: false,
  sendBotTextMock: vi.fn(),
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    bot: {
      get messageFormatMode() {
        return mocked.messageFormatMode;
      },
      get scheduledTaskNotificationsSilent() {
        return mocked.scheduledTaskNotificationsSilent;
      },
    },
  },
}));

vi.mock("../../../src/bot/messages/telegram-text.js", () => ({
  sendBotText: mocked.sendBotTextMock,
}));

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

async function createSender() {
  const { createScheduledTaskDeliverySender } = await import(
    "../../../src/bot/messages/scheduled-task-delivery.js"
  );

  return createScheduledTaskDeliverySender({ sendMessage: vi.fn() } as never, 777);
}

describe("bot/messages/scheduled-task-delivery", () => {
  beforeEach(() => {
    mocked.messageFormatMode = "markdown";
    mocked.scheduledTaskNotificationsSilent = false;
    mocked.sendBotTextMock.mockReset();
  });

  it("keeps existing success result suppression when a footer is sent", async () => {
    const sender = await createSender();

    await sender.send(createDelivery());

    expect(mocked.sendBotTextMock).toHaveBeenCalledTimes(2);
    expect(mocked.sendBotTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chatId: 777,
        format: "markdown_v2",
        options: { disable_notification: true },
      }),
    );
    expect(mocked.sendBotTextMock).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({
        options: { disable_notification: true },
      }),
    );
  });

  it("marks success body and footer messages silent when scheduled task notifications are disabled", async () => {
    mocked.scheduledTaskNotificationsSilent = true;
    const sender = await createSender();

    await sender.send(createDelivery());

    expect(mocked.sendBotTextMock).toHaveBeenCalledTimes(2);
    expect(mocked.sendBotTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chatId: 777,
        format: "markdown_v2",
        options: { disable_notification: true },
      }),
    );
    expect(mocked.sendBotTextMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chatId: 777,
        format: "raw",
        options: { disable_notification: true },
      }),
    );
  });

  it("marks scheduled task error notifications silent when configured", async () => {
    mocked.scheduledTaskNotificationsSilent = true;
    const sender = await createSender();

    await sender.send(
      createDelivery({
        status: "error",
        notificationText: "❌ Scheduled task failed: Task failed",
        resultText: undefined,
        footerText: undefined,
      }),
    );

    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        format: "raw",
        text: "❌ Scheduled task failed: Task failed",
        options: { disable_notification: true },
      }),
    );
  });
});
