import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { promptAttachment } from "../../../src/app/managers/prompt-attachment-manager.js";
import {
  ATTACHMENT_CANCEL_CALLBACK,
  handlePromptAttachmentCancel,
} from "../../../src/bot/callbacks/prompt-attachment-callback-handler.js";
import { createTestAppContainer } from "../../helpers/app-container.js";
import type { AppContainer } from "../../../src/app/bootstrap/app-container.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createContext(data: string): Context {
  return {
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createDeps() {
  return container;
}

let container: AppContainer;

beforeEach(() => {
  container = createTestAppContainer();
});

describe("bot/callbacks/prompt-attachment-callback-handler", () => {
  beforeEach(() => {
    promptAttachment.__resetForTests();
    container.interactionManager.clear("test_reset");
  });

  it("ignores callbacks that belong to other handlers", async () => {
    const ctx = createContext("ls:download:/repo/a.ts");

    expect(await handlePromptAttachmentCancel(ctx, createDeps())).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
  });

  it("clears the attachment and the waiting mode", async () => {
    promptAttachment.set("/repo/src/index.ts", "/repo");
    container.interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
      metadata: { flow: "attachment" },
    });

    const ctx = createContext(ATTACHMENT_CANCEL_CALLBACK);

    expect(await handlePromptAttachmentCancel(ctx, createDeps())).toBe(true);
    expect(promptAttachment.get()).toBeNull();
    expect(container.interactionManager.getSnapshot()).toBeNull();
  });

  it("drops the keyboard so the button cannot be pressed twice", async () => {
    promptAttachment.set("/repo/src/index.ts", "/repo");
    const ctx = createContext(ATTACHMENT_CANCEL_CALLBACK);

    await handlePromptAttachmentCancel(ctx, createDeps());

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    // A single argument means no reply_markup is carried over.
    expect((ctx.editMessageText as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(
      1,
    );
  });
});
