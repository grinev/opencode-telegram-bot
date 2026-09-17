import { beforeEach, describe, expect, it, vi } from "#vitest";

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockPromptAsync = vi.hoisted(() => vi.fn());
vi.mock("#src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      promptAsync: mockPromptAsync,
    },
  },
}));

import { loadSut } from "#helpers/sut-loader.js";
import { en } from "../../../src/i18n/en.js";

const sut = await loadSut<typeof import("#src/bot/services/cjk-correction-service.js")>(
  "#src/bot/services/cjk-correction-service.ts",
  import.meta.url,
);

const context = {
  directory: "/tmp/project",
  agent: "build",
  providerID: "test-provider",
  modelID: "test-model",
};

const BLOCKED_CJK = "你好，世界！你好，世界！ok";
const SIGNIFICANT_FRAGMENT =
  "你好，世界！你好，世界！ Esto es el resto del mensaje en español perfectamente legible.";

describe("bot/services/cjk-correction-service", () => {
  beforeEach(() => {
    sut._resetCjkCorrectionState();
    mockPromptAsync.mockReset();
    mockPromptAsync.mockResolvedValue({ data: undefined, error: undefined });
  });

  it("does nothing for clean messages", async () => {
    const text = "Todo en español, perfecto.";
    const plan = await sut.planCjkCorrection("s1", context, text);

    expect(plan).toEqual({ replacementText: null, correctionRequested: false, sanitizedText: text });
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });

  it("requests a Spanish rewrite for mostly-CJK messages and replaces them with the notice", async () => {
    const plan = await sut.planCjkCorrection("s1", context, BLOCKED_CJK);

    expect(plan.correctionRequested).toBe(true);
    expect(plan.replacementText).toBe(en["cjk_guard.correcting_notice"]);

    expect(mockPromptAsync).toHaveBeenCalledOnce();
    const options = mockPromptAsync.mock.calls[0]?.[0] as {
      sessionID: string;
      directory: string;
      agent: string;
      model: { providerID: string; modelID: string };
      parts: { type: string; text: string }[];
    };
    expect(options.sessionID).toBe("s1");
    expect(options.directory).toBe("/tmp/project");
    expect(options.agent).toBe("build");
    expect(options.model).toEqual({ providerID: "test-provider", modelID: "test-model" });
    expect(options.parts[0]).toEqual(
      expect.objectContaining({ type: "text", text: expect.stringContaining("español") }),
    );
  });

  it("requests a rewrite for significant fragments but keeps the sanitized text", async () => {
    const plan = await sut.planCjkCorrection("s1", context, SIGNIFICANT_FRAGMENT);

    expect(plan.correctionRequested).toBe(true);
    expect(plan.replacementText).toBeNull();
    expect(plan.sanitizedText).not.toMatch(/[\u4e00-\u9fff]/);
    expect(mockPromptAsync).toHaveBeenCalledOnce();
  });

  it("strips small fragments without requesting a rewrite", async () => {
    const plan = await sut.planCjkCorrection("s1", context, "Hola 你好 mundo");

    expect(plan).toEqual({
      replacementText: null,
      correctionRequested: false,
      sanitizedText: "Hola  mundo",
    });
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });

  it("gives up after the maximum number of attempts and resets on a clean message", async () => {
    const first = await sut.planCjkCorrection("s1", context, BLOCKED_CJK);
    const second = await sut.planCjkCorrection("s1", context, BLOCKED_CJK);
    const third = await sut.planCjkCorrection("s1", context, BLOCKED_CJK);

    expect(first.correctionRequested).toBe(true);
    expect(second.correctionRequested).toBe(true);
    expect(third.correctionRequested).toBe(false);
    expect(third.replacementText).toBe(en["cjk_guard.blocked_notice"]);
    expect(mockPromptAsync).toHaveBeenCalledTimes(2);

    await sut.planCjkCorrection("s1", context, "Mensaje limpio en español.");
    const afterReset = await sut.planCjkCorrection("s1", context, BLOCKED_CJK);

    expect(afterReset.correctionRequested).toBe(true);
    expect(mockPromptAsync).toHaveBeenCalledTimes(3);
  });

  it("reports the failure notice when the rewrite request throws", async () => {
    mockPromptAsync.mockRejectedValueOnce(new Error("api down"));

    const plan = await sut.planCjkCorrection("s1", context, BLOCKED_CJK);

    expect(plan.correctionRequested).toBe(false);
    expect(plan.replacementText).toBe(en["cjk_guard.blocked_notice"]);
  });
});
