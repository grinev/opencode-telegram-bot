import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetAssistantResponseExportsForTests,
  createAssistantResponseDocument,
  getRememberedAssistantResponse,
  rememberAssistantResponse,
  shouldAutomaticallyExportAssistantResponse,
} from "../../../src/bot/services/assistant-response-export-service.js";

describe("assistant response Markdown exports", () => {
  beforeEach(() => {
    __resetAssistantResponseExportsForTests();
  });

  it("does not automatically export responses at or below the default threshold", () => {
    expect(shouldAutomaticallyExportAssistantResponse("a".repeat(5000))).toBe(false);
  });

  it("automatically exports responses above the default threshold", () => {
    expect(shouldAutomaticallyExportAssistantResponse("a".repeat(5001))).toBe(true);
  });

  it("preserves UTF-8 Markdown exactly once in the document buffer", () => {
    const text = '# Résumé\n\n```ts\nconst value = "日本語";\n```';
    const document = createAssistantResponseDocument(text, new Date(2026, 7, 10, 19, 45));

    expect(document.filename).toBe("opencode-response-2026-08-10-1945.md");
    expect(document.buffer.toString("utf8")).toBe(text);
  });

  it("keeps only the latest response per chat and session", () => {
    rememberAssistantResponse(10, "session-a", "first");
    rememberAssistantResponse(10, "session-a", "second");
    rememberAssistantResponse(10, "session-b", "other chat session");
    rememberAssistantResponse(11, "session-a", "other chat");

    expect(getRememberedAssistantResponse(10, "session-a")).toBe("second");
    expect(getRememberedAssistantResponse(10, "session-b")).toBe("other chat session");
    expect(getRememberedAssistantResponse(11, "session-a")).toBe("other chat");
    expect(getRememberedAssistantResponse(12, "session-a")).toBeNull();
  });
});
