import { describe, expect, it } from "vitest";
import type { MessageEntity } from "grammy/types";
import { validateTelegramEntities } from "../../../src/telegram/render/validator.js";

describe("telegram/render/validator", () => {
  it("accepts nested style entities and style-link nesting", () => {
    const text = "hello world";
    const entities: MessageEntity[] = [
      { type: "bold", offset: 0, length: 11 },
      { type: "italic", offset: 6, length: 5 },
      { type: "text_link", offset: 0, length: 5, url: "https://example.com" },
      { type: "underline", offset: 0, length: 5 },
    ];

    expect(validateTelegramEntities(text, entities)).toEqual({ ok: true, issues: [] });
  });

  it("rejects invalid offsets and lengths", () => {
    const result = validateTelegramEntities("hello", [
      { type: "bold", offset: -1, length: 2 },
      { type: "italic", offset: 1, length: 0 },
      { type: "underline", offset: 4, length: 2 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "invalid_offset",
      "invalid_length",
      "range_out_of_bounds",
    ]);
  });

  it("rejects partial overlaps", () => {
    const result = validateTelegramEntities("hello world", [
      { type: "bold", offset: 0, length: 5 },
      { type: "italic", offset: 3, length: 5 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("partial_overlap");
  });

  it("rejects any overlap with code entities", () => {
    const result = validateTelegramEntities("hello", [
      { type: "code", offset: 0, length: 5 },
      { type: "bold", offset: 0, length: 5 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("code_overlap");
  });

  it("rejects nested links and duplicate same-range entities", () => {
    const result = validateTelegramEntities("hello world", [
      { type: "text_link", offset: 0, length: 11, url: "https://example.com" },
      { type: "text_link", offset: 6, length: 5, url: "https://example.org" },
      { type: "bold", offset: 0, length: 5 },
      { type: "bold", offset: 0, length: 5 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "nested_link",
      "duplicate_entity_range",
    ]);
  });

  it("rejects invalid link urls", () => {
    const result = validateTelegramEntities("hello", [
      { type: "text_link", offset: 0, length: 5, url: "javascript:alert(1)" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("invalid_link_url");
  });

  it("rejects loopback http link urls", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      const result = validateTelegramEntities("hello", [
        { type: "text_link", offset: 0, length: 5, url },
      ]);

      expect(result.ok).toBe(false);
      expect(result.issues[0]?.code).toBe("invalid_link_url");
    }
  });
});
