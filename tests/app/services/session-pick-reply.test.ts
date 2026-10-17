import { describe, expect, it } from "vitest";
import {
  buildSessionPickQuote,
  findEligibleReply,
  findLatestUserPrompt,
  findPendingUserPrompt,
  type SessionPickMessage,
} from "../../../src/app/services/session-pick-reply.js";

function message(
  role: "user" | "assistant",
  text: string | null,
  created: number,
  extra: Partial<SessionPickMessage["info"]> = {},
  parts: SessionPickMessage["parts"] = text === null ? [] : [{ type: "text", text }],
): SessionPickMessage {
  return {
    info: {
      id: extra.id ?? `${role}-${created}`,
      role,
      time: { created, ...extra.time },
      ...extra,
    },
    parts,
  };
}

describe("session pick reply", () => {
  it("skips a tools-only message and a summary", () => {
    const selected = findEligibleReply(
      [
        message("assistant", "earlier", 1, { time: { created: 1, completed: 2 } }),
        message("assistant", null, 3, { time: { created: 3, completed: 4 } }, [{ type: "tool" }]),
        message("assistant", "summary", 5, { summary: true, time: { created: 5, completed: 6 } }),
      ],
      false,
    );

    expect(selected?.text).toBe("earlier");
  });

  it("skips an aborted or errored reply even when it has text", () => {
    const selected = findEligibleReply(
      [
        message("assistant", "kept", 1, { time: { created: 1, completed: 2 } }),
        message("assistant", "partial", 3, {
          error: { name: "MessageAbortedError" },
          time: { created: 3, completed: 4 },
        }),
      ],
      false,
    );

    expect(selected?.text).toBe("kept");
  });

  it("quotes the prompt alone when every reply is ineligible", () => {
    const messages = [
      message("user", "the prompt", 1),
      message("assistant", "partial", 2, { error: { name: "APIError" } }),
    ];

    expect(findEligibleReply(messages, false)).toBeNull();
    expect(findLatestUserPrompt(messages)?.info.id).toBe("user-1");
  });

  it("returns the newest prompt when it was created after the shown reply", () => {
    const messages = [
      message("user", "answered prompt", 1, { id: "user-old" }),
      message("assistant", "reply", 2, {
        id: "assistant-1",
        parentID: "user-old",
        time: { created: 2, completed: 3 },
      }),
      message("user", "waiting prompt", 4, { id: "user-new" }),
    ];

    expect(findPendingUserPrompt(messages, 2)?.info.id).toBe("user-new");
  });

  it("returns nothing when the newest prompt predates the shown reply", () => {
    const messages = [
      message("user", "the prompt", 1, { id: "user-1" }),
      message("assistant", "reply", 2, {
        id: "assistant-1",
        parentID: "user-1",
        time: { created: 2, completed: 3 },
      }),
    ];

    expect(findPendingUserPrompt(messages, 2)).toBeNull();
    expect(findPendingUserPrompt(messages, 3)).toBeNull();
  });

  it("returns nothing when the session has no user prompt", () => {
    expect(findPendingUserPrompt([message("assistant", "reply", 1)], 1)).toBeNull();
  });

  it("drops an in-flight reply while the session is busy", () => {
    const selected = findEligibleReply(
      [
        message("assistant", "finished", 1, { time: { created: 1, completed: 2 } }),
        message("assistant", "still writing", 3, { time: { created: 3 } }),
      ],
      true,
    );

    expect(selected?.text).toBe("finished");
  });

  it("keeps an unfinished reply when the session is idle", () => {
    const selected = findEligibleReply(
      [message("assistant", "still there", 3, { time: { created: 3 } })],
      false,
    );

    expect(selected?.text).toBe("still there");
  });

  it("quotes text only when the prompt also has files", () => {
    const quote = buildSessionPickQuote(
      message("user", "caption", 1, {}, [
        { type: "text", text: "caption" },
        { type: "file", filename: "shot.png" },
      ]),
    );

    expect(quote?.rawFallbackText).toContain("caption");
    expect(quote?.rawFallbackText).not.toContain("shot.png");
  });

  it("lists file names when the prompt has no text", () => {
    const quote = buildSessionPickQuote(
      message("user", null, 1, {}, [
        { type: "file", filename: "shot.png" },
        { type: "file", filename: "  " },
      ]),
    );

    expect(quote?.rawFallbackText).toContain("📎 shot.png");
    expect(quote?.rawFallbackText).toContain("📎 attachment");
  });

  it("cuts the quote at 2000 characters", () => {
    const quote = buildSessionPickQuote(message("user", "a".repeat(2005), 1));

    expect(quote?.rawFallbackText).toContain(`${"a".repeat(1997)}...`);
    expect(quote?.rawFallbackText).not.toContain("a".repeat(2000));
  });
});
