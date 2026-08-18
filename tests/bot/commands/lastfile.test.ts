import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  currentSessionMock: vi.fn(),
  getResponseMock: vi.fn(),
  sendDocumentMock: vi.fn(),
}));

vi.mock("../../../src/app/services/session-service.js", () => ({
  getCurrentSession: mocked.currentSessionMock,
}));

vi.mock("../../../src/bot/services/assistant-response-export-service.js", () => ({
  getRememberedAssistantResponse: mocked.getResponseMock,
  sendAssistantResponseDocument: mocked.sendDocumentMock,
}));

import { lastfileCommand } from "../../../src/bot/commands/lastfile-command.js";

function createContext(): Context {
  return {
    chat: { id: 123 },
    api: {},
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("/lastfile", () => {
  beforeEach(() => {
    mocked.currentSessionMock.mockReset();
    mocked.getResponseMock.mockReset();
    mocked.sendDocumentMock.mockReset();
    mocked.currentSessionMock.mockReturnValue({ id: "session-1" });
  });

  it("explains when no response is available", async () => {
    mocked.getResponseMock.mockReturnValue(null);
    const ctx = createContext();

    await lastfileCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "No successfully delivered assistant response is available for this session.",
    );
  });

  it("exports only the current chat and session response", async () => {
    mocked.getResponseMock.mockReturnValue("# Final answer");
    const ctx = createContext();

    await lastfileCommand(ctx);

    expect(mocked.getResponseMock).toHaveBeenCalledWith(123, "session-1");
    expect(mocked.sendDocumentMock).toHaveBeenCalledWith(ctx.api, 123, "# Final answer");
  });
});
