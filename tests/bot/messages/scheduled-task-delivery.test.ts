import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedScheduledTaskDelivery } from "../../../src/app/types/scheduled-task.js";

const mocked = vi.hoisted(() => ({
  readImage: vi.fn(),
  readDocument: vi.fn(),
  classifyDocuments: vi.fn(),
  bot: {
    messageFormatMode: "markdown" as "markdown" | "raw",
    scheduledTaskNotificationsSilent: false,
  },
}));
vi.mock("../../../src/app/services/assistant-image-service.js", () => ({
  readAssistantImage: mocked.readImage,
}));
vi.mock("../../../src/app/services/assistant-document-service.js", async (original) => ({
  ...(await original<typeof import("../../../src/app/services/assistant-document-service.js")>()),
  readAssistantDocument: mocked.readDocument,
  classifyAssistantDocuments: mocked.classifyDocuments,
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
    mocked.readDocument.mockReset().mockResolvedValue({ bytes: Buffer.from("document") });
    mocked.classifyDocuments.mockReset().mockResolvedValue(new Map());
    mocked.readImage
      .mockReset()
      .mockResolvedValue({ bytes: new Uint8Array([1]), filename: "a.png" });
    config.bot.messageFormatMode = "markdown";
    config.bot.scheduledTaskNotificationsSilent = false;
  });

  it.each([false, true])(
    "sends scheduled documents after the header and all text, before the footer (silent=%s)",
    async (silent) => {
      config.bot.scheduledTaskNotificationsSilent = silent;
      const order: string[] = [];
      const sendRichMessage = vi.fn(async () => {
        order.push("text");
        return { message_id: 1 };
      });
      const sendDocument = vi.fn(async () => {
        order.push("document");
        return { message_id: 2 };
      });
      const sendMessage = vi.fn(async () => {
        order.push("footer");
        return { message_id: 3 };
      });
      await createScheduledTaskDeliverySender(
        { sendMessage, sendRichMessage, sendDocument } as never,
        777,
      ).send(
        createDelivery({
          resultText: "[report](report.bin)",
          projectDirectory: "/p",
          footerText: "Build",
        }),
      );
      expect(order).toEqual(["text", "document", "footer"]);
      expect((sendDocument.mock.calls[0] as unknown[] | undefined)?.[2]).toMatchObject({
        disable_notification: true,
        caption: "report",
      });
      expect(mocked.readDocument).toHaveBeenCalledWith("/p", "report.bin", "unknown");
    },
  );

  it("does not send documents or replay accepted text after a result text failure", async () => {
    const sendDocument = vi.fn();
    const sendRichMessage = vi.fn().mockRejectedValue(new Error("connection reset"));
    const sender = createScheduledTaskDeliverySender(
      { sendMessage: vi.fn(), sendRichMessage, sendDocument },
      777,
    );
    expect(
      await sender.send(createDelivery({ resultText: "[a](a.txt)", projectDirectory: "/p" })),
    ).toBe(true);
    expect(sendRichMessage).toHaveBeenCalledTimes(1);
    expect(sendDocument).not.toHaveBeenCalled();
    expect(mocked.readDocument).not.toHaveBeenCalled();
  });

  it("sends an image-only result with its literal task header inside the same rich message", async () => {
    const sendRichMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const sendMessage = vi.fn();
    const sender = createScheduledTaskDeliverySender(
      { sendMessage, sendRichMessage, sendDocument: vi.fn() },
      777,
    );
    await sender.send(
      createDelivery({
        notificationText: "Task **literal**",
        resultText: "![](a.png)",
        projectDirectory: "/remote/p",
      }),
    );
    expect(
      sendRichMessage.mock.calls[0]?.[1].blocks.map((block: { type: string }) => block.type),
    ).toEqual(["paragraph", "photo"]);
    expect(sendRichMessage.mock.calls[0]?.[1].blocks[0].text).toBe("Task **literal**");
    expect(mocked.readImage).toHaveBeenCalledWith("/remote/p", "a.png");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("consumes an ambiguously attempted rich result rather than asking the runtime queue to resend it", async () => {
    const sendRichMessage = vi.fn().mockRejectedValue(new Error("connection reset"));
    const sender = createScheduledTaskDeliverySender(
      { sendMessage: vi.fn(), sendRichMessage, sendDocument: vi.fn() },
      777,
    );
    expect(
      await sender.send(
        createDelivery({ resultText: "![](a.png)", projectDirectory: "/remote/p" }),
      ),
    ).toBe(true);
    expect(sendRichMessage).toHaveBeenCalledTimes(1);
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
