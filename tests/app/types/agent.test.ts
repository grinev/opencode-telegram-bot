import { describe, expect, it } from "vitest";
import {
  AGENT_EMOJI,
  getAgentButtonLabel,
  getAgentDisplayName,
  getAgentEmoji,
} from "../../../src/app/types/agent.js";

describe("app/types/agent", () => {
  it("returns mapped emoji for known agents", () => {
    expect(getAgentEmoji("build")).toBe("🛠️");
    expect(getAgentEmoji("plan")).toBe("📋");
    expect(AGENT_EMOJI.general).toBe("💬");
  });

  it("returns fallback emoji for unknown agents", () => {
    expect(getAgentEmoji("custom-agent")).toBe("🤖");
  });

  it("builds display name with emoji and capitalized agent name", () => {
    expect(getAgentDisplayName("build")).toBe("🛠️ Build");
    expect(getAgentDisplayName("customAgent")).toBe("🤖 CustomAgent");
  });

  it("builds reply keyboard agent label with Agent suffix", () => {
    expect(getAgentButtonLabel("build")).toBe("🛠️ Build Agent");
    expect(getAgentButtonLabel("customAgent")).toBe("🤖 CustomAgent Agent");
  });
});
