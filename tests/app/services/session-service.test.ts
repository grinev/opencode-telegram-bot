import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsSession = vi.hoisted(() => ({ current: null as { id: string } | null }));

vi.mock("../../../src/app/stores/settings-store.js", () => ({
  getCurrentSession: vi.fn(() => settingsSession.current),
  setCurrentSession: vi.fn((session: { id: string }) => {
    settingsSession.current = session;
  }),
  clearSession: vi.fn(() => {
    settingsSession.current = null;
  }),
}));

import { promptQueue } from "../../../src/app/managers/prompt-queue-manager.js";
import { promptAttachment } from "../../../src/app/managers/prompt-attachment-manager.js";
import { clearSession, setCurrentSession } from "../../../src/app/services/session-service.js";
import { createIncomingPrompt } from "../../../src/app/types/prompt.js";
import {
  clearPromptResponseMode,
  consumePromptResponseMode,
  setPromptResponseMode,
} from "../../../src/app/managers/prompt-response-mode-manager.js";

const SESSION = { id: "session-1", title: "Session 1", directory: "D:\\Projects\\Repo" };

describe("app/services/session-service", () => {
  beforeEach(() => {
    settingsSession.current = null;
    promptQueue.__resetForTests();
    promptAttachment.__resetForTests();
    clearPromptResponseMode("session-1");
    clearPromptResponseMode("session-2");
  });

  it("drops queued prompts when switching to another session", () => {
    setCurrentSession(SESSION);
    promptQueue.add(createIncomingPrompt("queued for session 1"));

    setCurrentSession({ ...SESSION, id: "session-2" });

    expect(promptQueue.size()).toBe(0);
  });

  it("retires response modes when switching away from an abandoned session", () => {
    setCurrentSession(SESSION);
    setPromptResponseMode("session-1", "message-1", "text_and_tts");

    setCurrentSession({ ...SESSION, id: "session-2" });

    expect(consumePromptResponseMode("session-1", "message-1")).toBeNull();
  });

  it("keeps queued prompts when the same session is only renamed", () => {
    setCurrentSession(SESSION);
    promptQueue.add(createIncomingPrompt("queued for session 1"));

    setCurrentSession({ ...SESSION, title: "Renamed" });

    expect(promptQueue.size()).toBe(1);
  });

  it("drops queued prompts when the session is cleared", () => {
    setCurrentSession(SESSION);
    promptQueue.add(createIncomingPrompt("queued for session 1"));

    clearSession();

    expect(promptQueue.size()).toBe(0);
  });

  it("drops the pending attachment when switching to another session", () => {
    setCurrentSession(SESSION);
    promptAttachment.set("D:\\Projects\\Repo\\src\\index.ts", "D:\\Projects\\Repo");

    setCurrentSession({ ...SESSION, id: "session-2" });

    expect(promptAttachment.get()).toBeNull();
  });

  it("keeps the pending attachment when the same session is only renamed", () => {
    setCurrentSession(SESSION);
    promptAttachment.set("D:\\Projects\\Repo\\src\\index.ts", "D:\\Projects\\Repo");

    setCurrentSession({ ...SESSION, title: "Renamed" });

    expect(promptAttachment.get()).not.toBeNull();
  });

  it("drops the pending attachment when the session is cleared", () => {
    setCurrentSession(SESSION);
    promptAttachment.set("D:\\Projects\\Repo\\src\\index.ts", "D:\\Projects\\Repo");

    clearSession();

    expect(promptAttachment.get()).toBeNull();
  });
});
