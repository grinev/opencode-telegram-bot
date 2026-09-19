import type { InteractionManager } from "../../src/app/managers/interaction-manager.js";
import type {
  InteractionKind,
  InteractionState,
  StartInteractionOptions,
} from "../../src/app/types/interaction.js";

type TestInteractionOptions = Omit<StartInteractionOptions, "kind" | "payload"> & {
  kind: InteractionKind;
};

/**
 * Opens the given interaction slot for guard-level tests that only care about the
 * kind, filling a stateful kind with empty data.
 */
export function startInteractionForTest(
  interactionManager: InteractionManager,
  options: TestInteractionOptions,
): InteractionState {
  switch (options.kind) {
    case "question":
      return interactionManager.start({
        ...options,
        kind: "question",
        payload: {
          questions: [],
          currentIndex: 0,
          selectedOptions: new Map(),
          customAnswers: new Map(),
          customInputQuestionIndex: null,
          activeMessageId: null,
          messageIds: [],
          requestID: null,
        },
      });
    case "permission":
      return interactionManager.start({
        ...options,
        kind: "permission",
        payload: {
          requestsByMessageId: new Map(),
          requestIdsByMessageId: new Map(),
          messageIdBySignature: new Map(),
        },
      });
    case "rename":
      return interactionManager.start({
        ...options,
        kind: "rename",
        payload: {
          sessionId: "session-test",
          sessionDirectory: "D:/repo",
          currentTitle: "Test session",
          messageId: null,
        },
      });
    case "task":
      return interactionManager.start({
        ...options,
        kind: "task",
        payload: {
          stage: "awaiting_schedule",
          projectId: "project-test",
          projectWorktree: "D:/repo",
          agent: "build",
          model: { providerID: "test-provider", modelID: "test-model", variant: null },
          scheduleText: null,
          parsedSchedule: null,
          scheduleRequestMessageId: null,
          previewMessageId: null,
          promptRequestMessageId: null,
        },
      });
    case "inline":
    case "custom":
      return interactionManager.start({ ...options, kind: options.kind });
  }
}
