import { isRecord } from "../../utils/type-guards.js";

/** A kickoff or continuation the server marked as its own, not a person's message. */
export function isGoalInternalMetadata(metadata: unknown): boolean {
  return isRecord(metadata) && metadata.source === "goal";
}
