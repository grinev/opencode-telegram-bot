import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  classify: vi.fn(),
  read: vi.fn(),
  wait: vi.fn(),
}));
vi.mock("../../../src/app/services/assistant-document-service.js", async (original) => ({
  ...(await original<typeof import("../../../src/app/services/assistant-document-service.js")>()),
  classifyAssistantDocuments: mocked.classify,
  readAssistantDocument: mocked.read,
}));
vi.mock("../../../src/app/services/telegram-outage-notice-service.js", () => ({
  telegramOutageNoticeService: { msUntilAllowedSend: mocked.wait, __resetForTests: vi.fn() },
}));
import { config } from "../../../src/config.js";
import {
  prepareAssistantDocuments,
  deliverAssistantDocuments,
} from "../../../src/bot/messages/assistant-document-delivery.js";

describe("assistant document delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.bot.messageFormatMode = "markdown";
    mocked.classify.mockResolvedValue(new Map());
    mocked.read.mockResolvedValue({ bytes: Buffer.from("file") });
    mocked.wait.mockReturnValue(0);
  });

  it("preserves directory links and label formatting, and retains repeated file requests", async () => {
    mocked.classify.mockResolvedValue(
      new Map([
        ["src", "directory"],
        ["a.txt", "file"],
      ]),
    );
    const prepared = await prepareAssistantDocuments(
      "[dir](src) [**a**](a.txt) [a](a.txt)",
      "/remote/p",
    );
    expect(prepared.text).toBe("[dir](src) **a** a");
    expect(prepared.documents.map((link) => link.path)).toEqual(["a.txt", "a.txt"]);
  });

  it("uploads ordered documents with original filenames and plain captions; empty labels use filenames", async () => {
    const prepared = await prepareAssistantDocuments(
      "[**Title**](dir/original.zip) [](empty.txt)",
      "/remote/p",
    );
    const api = { sendDocument: vi.fn().mockResolvedValue({}), sendMessage: vi.fn() };
    await deliverAssistantDocuments(prepared, api, 7, { disable_notification: true });
    expect(api.sendDocument.mock.calls.map((call) => [call[1].filename, call[2]])).toEqual([
      ["original.zip", { caption: "Title", disable_notification: true }],
      ["empty.txt", { caption: "empty.txt", disable_notification: true }],
    ]);
    expect(mocked.read.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["/remote/p", "dir/original.zip"],
      ["/remote/p", "empty.txt"],
    ]);
  });

  it("localizes independent failures in position, without previews or aborting later uploads", async () => {
    const prepared = await prepareAssistantDocuments("[one](one) [two](two) [three](three)", "/p");
    const order: string[] = [];
    mocked.read
      .mockResolvedValueOnce({ reason: "unavailable" })
      .mockResolvedValueOnce({ bytes: Buffer.from("two") });
    const api = {
      sendDocument: vi.fn().mockImplementation(async (_chat, file) => {
        order.push(file.filename);
      }),
      sendMessage: vi.fn().mockImplementation(async (_chat, text) => {
        order.push(text);
        return { message_id: 1 };
      }),
    };
    await deliverAssistantDocuments(prepared, api, 7);
    expect(order[0]).toContain("one");
    expect(order.slice(1)).toEqual(["two", "three"]);
    expect(api.sendMessage.mock.calls[0]?.[2]?.link_preview_options?.is_disabled).not.toBe(false);
  });

  it("continues after an ambiguous upload and reports size errors using the effective limit", async () => {
    const prepared = await prepareAssistantDocuments("[one](one) [two](two)", "/p");
    const api = {
      sendDocument: vi
        .fn()
        .mockRejectedValueOnce(new Error("413 entity too large"))
        .mockResolvedValueOnce({}),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    };
    await deliverAssistantDocuments(prepared, api, 7);
    expect(api.sendDocument).toHaveBeenCalledTimes(2);
    expect(api.sendMessage.mock.calls[0]?.[1]).toContain(
      String(config.files.outgoingDocumentMaxSizeMb),
    );
  });

  it("does not leak uploads or notices after a session switch during remote reads", async () => {
    let current = true;
    const prepared = await prepareAssistantDocuments("[one](one) [two](two)", "/p", () => current);
    mocked.read.mockImplementationOnce(async () => {
      current = false;
      return { bytes: Buffer.from("one") };
    });
    const api = { sendDocument: vi.fn(), sendMessage: vi.fn() };
    await deliverAssistantDocuments(prepared, api, 7);
    expect(api.sendDocument).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(mocked.read).toHaveBeenCalledTimes(1);
  });

  it("caps captions at 1024 and leaves raw output unchanged without remote reads", async () => {
    const prepared = await prepareAssistantDocuments(`[${"x".repeat(2000)}](a.txt)`, "/p");
    const api = { sendDocument: vi.fn().mockResolvedValue({}), sendMessage: vi.fn() };
    await deliverAssistantDocuments(prepared, api, 7);
    expect(api.sendDocument.mock.calls[0]?.[2]?.caption).toHaveLength(1024);
    config.bot.messageFormatMode = "raw";
    mocked.classify.mockClear();
    expect(await prepareAssistantDocuments("[a](a.txt)", "/p")).toMatchObject({
      text: "[a](a.txt)",
      documents: [],
    });
    expect(mocked.classify).not.toHaveBeenCalled();
  });
});
