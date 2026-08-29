/**
 * Session Settings Service - adopts the agent and model a session last ran with
 */
import type { Session } from "@opencode-ai/sdk/v2";
import { selectAgent } from "./agent-selection-service.js";
import { selectModel } from "./model-selection-service.js";
import { logger } from "../../utils/logger.js";

/**
 * Apply the agent and model stored on a session to the current settings.
 * Agent and model are adopted independently: a session that carries only one of
 * them changes only that one, and a session that was never prompted changes
 * nothing. The variant is part of the model record and is never adopted on its
 * own, so a model without a variant is stored at "default".
 * @param session Session to read the settings from
 */
export function applySessionSettings(session: Session): void {
  const model = session.model;

  if (session.agent) {
    selectAgent(session.agent);
  }

  if (model?.providerID && model.id) {
    selectModel({
      providerID: model.providerID,
      modelID: model.id,
      variant: model.variant || "default",
    });
  }

  if (!session.agent && !model) {
    logger.debug(`[SessionSettings] Session ${session.id} carries no agent or model to pull`);
    return;
  }

  logger.info(
    `[SessionSettings] Pulled from session ${session.id}: agent=${session.agent ?? "unchanged"}, model=${
      model?.providerID && model.id
        ? `${model.providerID}/${model.id} (${model.variant || "default"})`
        : "unchanged"
    }`,
  );
}
