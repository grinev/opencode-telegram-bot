import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedScheduledTaskDelivery } from "../../../src/app/types/scheduled-task.js";

const mocked = vi.hoisted(() => ({
  bot: {
    messageFormatMode: "markdown" as "markdown" | "raw",
    scheduledTaskNotificationsSilent: false,
  },
}));

vi.mock("../../../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/config.js")>();
  return {
    ...actual,
    config: { ...actual.config, bot: Object.assign({ ...actual.config.bot }, mocked.bot) },
  };
});

import { config } from "../../../src/config.js";
import { createScheduledTaskDeliverySender } from "../../../src/bot/messages/scheduled-task-delivery.js";

const agentPreview = { link_preview_options: { is_disabled: false } };

function createDelivery(
  overrides: Partial<QueuedScheduledTaskDelivery> = {},
): QueuedScheduledTaskDelivery {
  return {
    taskId: "task-1",
    scheduleSummary: "Every day",
    prompt: "Send report",
    runAt: "2026-03-16T10:00:00.000Z",
    status: "success",
    notificationText: "Scheduled task finished: https://example.com/task",
    resultText: "See https://example.com/report",
    ...overrides,
  };
}

async function sendAndCollect(delivery: QueuedScheduledTaskDelivery) {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  await createScheduledTaskDeliverySender({ sendMessage } as never, 777).send(delivery);
  return sendMessage.mock.calls.map((call) => ({
    text: String(call[1]),
    options: call[2] as Record<string, unknown> | undefined,
  }));
}

describe("bot/messages/scheduled-task-delivery", () => {
  beforeEach(() => {
    config.bot.messageFormatMode = "markdown";
    config.bot.scheduledTaskNotificationsSilent = false;
  });

  it("keeps the link preview on the reply and turns it off on the footer", async () => {
    const calls = await sendAndCollect(createDelivery({ footerText: "Build · 1m" }));

    expect(calls).toHaveLength(2);
    expect(calls[0]?.text).toContain("example\\.com/report");
    expect(calls[0]?.options).toMatchObject({ disable_notification: true, ...agentPreview });
    expect(calls[1]?.text).toBe("Build · 1m");
    expect(calls[1]?.options?.link_preview_options).toBeUndefined();
  });

  it("keeps the link preview on every reply part in raw mode", async () => {
    config.bot.messageFormatMode = "raw";

    const calls = await sendAndCollect(createDelivery());

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.options).toMatchObject(agentPreview);
    }
  });

  it("leaves a header without the reply to the bot's default", async () => {
    const calls = await sendAndCollect(createDelivery({ resultText: "" }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.link_preview_options).toBeUndefined();
  });

  it("leaves a header split off from a long reply to the bot's default", async () => {
    const calls = await sendAndCollect(createDelivery({ resultText: "x".repeat(4090) }));

    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]?.text).toContain("Scheduled task finished");
    expect(calls[0]?.options?.link_preview_options).toBeUndefined();
    for (const call of calls.slice(1)) {
      expect(call.options).toMatchObject(agentPreview);
    }
  });

  it("leaves a failure notice to the bot's default", async () => {
    const calls = await sendAndCollect(
      createDelivery({ status: "error", resultText: "", notificationText: "Task failed" }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.link_preview_options).toBeUndefined();
  });
});
