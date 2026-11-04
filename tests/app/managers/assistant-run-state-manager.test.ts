import { describe, expect, it } from "vitest";
import { AssistantRunState } from "../../../src/app/managers/assistant-run-state-manager.js";

describe("app/managers/assistant-run-state", () => {
  it("adopts steps that arrived before an observed run opens and drops them on clear", () => {
    const state = new AssistantRunState();
    state.recordStep("ses-1", {
      messageID: "msg-1",
      created: 10,
      streamed: 20,
      output: 3,
      reasoning: 1,
    });

    state.startObservedRun("ses-1", 1);
    state.recordStep("ses-1", {
      messageID: "msg-1",
      created: 10,
      streamed: 40,
      output: 5,
      reasoning: 0,
    });

    const finished = state.finishRun("ses-1", "test");
    expect(finished?.steps).toEqual([
      { messageID: "msg-1", created: 10, streamed: 40, output: 5, reasoning: 0 },
    ]);

    state.recordStep("ses-1", {
      messageID: "late",
      created: 1,
      output: 1,
      reasoning: 0,
    });
    state.clearRun("ses-1", "test");
    state.startObservedRun("ses-1", 2);
    expect(state.finishRun("ses-1", "test")?.steps).toEqual([]);
  });

  it("lets a footerless mark win over an interrupted mark", () => {
    const state = new AssistantRunState();
    state.startRun("ses-1", { startedAt: 1 });
    state.suppressFooter("ses-1");
    state.markInterrupted("ses-1");

    expect(state.isFooterSuppressed("ses-1")).toBe(true);
    expect(state.finishRun("ses-1", "test")).toMatchObject({
      suppressFooter: true,
      interrupted: true,
    });
  });

  it("keeps a step that arrives after the run is sealed for the next run", () => {
    const state = new AssistantRunState();
    state.startRun("ses-1", { startedAt: 1 });
    state.recordStep("ses-1", {
      messageID: "old",
      created: 1,
      streamed: 2,
      output: 1,
      reasoning: 0,
    });
    state.sealRun("ses-1");
    state.recordStep("ses-1", {
      messageID: "next",
      created: 3,
      streamed: 4,
      output: 2,
      reasoning: 0,
    });

    expect(state.finishRun("ses-1", "idle")?.steps.map((step) => step.messageID)).toEqual(["old"]);

    state.startRun("ses-1", { startedAt: 5 });
    expect(state.finishRun("ses-1", "next")?.steps.map((step) => step.messageID)).toEqual(["next"]);
  });

  it("sends a sealed run's footer even when the next turn is already footerless", () => {
    const state = new AssistantRunState();
    state.startRun("ses-1", { startedAt: 1 });
    state.markResponseCompleted("ses-1");
    state.sealRun("ses-1");
    state.suppressFooter("ses-1");

    const finished = state.finishRun("ses-1", "idle");
    expect(finished?.suppressFooter).toBe(false);
    expect(state.isFooterSuppressed("ses-1")).toBe(false);

    state.startRun("ses-1", { startedAt: 2 });
    expect(state.isFooterSuppressed("ses-1")).toBe(true);
  });

  it("adopts a footerless mark when the observed run opens", () => {
    const state = new AssistantRunState();
    state.suppressFooter("ses-1");
    state.startObservedRun("ses-1", 1);

    expect(state.isFooterSuppressed("ses-1")).toBe(true);
  });
});
