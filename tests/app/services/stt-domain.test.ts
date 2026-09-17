import { describe, expect, it, vi } from "#vitest";

vi.mock("#src/utils/logger.ts", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { loadSut } from "#helpers/sut-loader.js";
const { applySttCorrections, buildSttPrompt, parseSttDomain, loadSttDomain } = await loadSut<
  typeof import("#src/app/services/stt-domain.js")
>("#src/app/services/stt-domain.ts", import.meta.url);

function tmpPath(name: string): string {
  return `.tmp/stt-domain-test-${process.pid}-${name}.json`;
}

describe("parseSttDomain", () => {
  it("returns empty domain for non-object input", () => {
    expect(parseSttDomain(null)).toEqual({ hotwords: [], corrections: {} });
    expect(parseSttDomain("nope")).toEqual({ hotwords: [], corrections: {} });
  });

  it("keeps string hotwords and drops invalid entries", () => {
    const domain = parseSttDomain({ hotwords: ["rudabook", "", 42, "  mergea  "] });
    expect(domain.hotwords).toEqual(["rudabook", "  mergea  "]);
  });

  it("keeps only string corrections", () => {
    const domain = parseSttDomain({
      corrections: { rutabug: "rudabook", bad: 7, empty: "" },
    });
    expect(domain.corrections).toEqual({ rutabug: "rudabook" });
  });
});

describe("buildSttPrompt", () => {
  it("returns empty string for empty or blank hotwords", () => {
    expect(buildSttPrompt([])).toBe("");
    expect(buildSttPrompt(["", "   "])).toBe("");
  });

  it("formats hotwords as a technical terms prompt", () => {
    expect(buildSttPrompt(["rudabook", "mergea"])).toBe("Technical terms: rudabook, mergea.");
  });
});

describe("applySttCorrections", () => {
  it("replaces case-insensitively at word boundaries", () => {
    expect(applySttCorrections("Haz un rebase de Rutabug ya", { rutabug: "rudabook" })).toBe(
      "Haz un rebase de rudabook ya",
    );
  });

  it("matches accented ASR output", () => {
    expect(applySttCorrections("despliega Rudabók", { rudabok: "rudabook" })).toBe(
      "despliega rudabook",
    );
  });

  it("applies longest keys first", () => {
    expect(
      applySttCorrections("la rama de ruda book", {
        ruda: "X",
        "ruda book": "rudabook",
      }),
    ).toBe("la rama de rudabook");
  });

  it("does not replace inside words", () => {
    expect(applySttCorrections("xrutabugx rutabug", { rutabug: "rudabook" })).toBe(
      "xrutabugx rudabook",
    );
  });

  it("returns the text unchanged when there are no corrections", () => {
    expect(applySttCorrections("texto intacto", {})).toBe("texto intacto");
  });
});

describe("loadSttDomain", () => {
  it("returns empty domain when path is unset", async () => {
    expect(await loadSttDomain(undefined)).toEqual({ hotwords: [], corrections: {} });
  });

  it("returns empty domain when the file is missing", async () => {
    expect(await loadSttDomain(tmpPath("missing"))).toEqual({ hotwords: [], corrections: {} });
  });

  it("loads a valid domain file", async () => {
    const path = tmpPath("valid");
    await Bun.write(
      path,
      JSON.stringify({ hotwords: ["rudabook"], corrections: { rutabug: "rudabook" } }),
    );

    expect(await loadSttDomain(path)).toEqual({
      hotwords: ["rudabook"],
      corrections: { rutabug: "rudabook" },
    });

    await Bun.file(path).delete();
  });

  it("returns empty domain for invalid JSON", async () => {
    const path = tmpPath("invalid");
    await Bun.write(path, "{not json");

    expect(await loadSttDomain(path)).toEqual({ hotwords: [], corrections: {} });

    await Bun.file(path).delete();
  });
});
