import type { FilePartInput, TextPart } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import type { ModelInfo } from "../types/model.js";
import {
  clearCurrentVisionModel,
  getCurrentVisionModel,
  setCurrentVisionModel,
} from "../stores/settings-store.js";
import { logger } from "../../utils/logger.js";

export function getStoredVisionModel(): ModelInfo | null {
  const model = getCurrentVisionModel();
  return model && model.providerID && model.modelID ? model : null;
}

export function isVisionModelConfigured(): boolean {
  return getStoredVisionModel() !== null;
}

export function setVisionModel(modelInfo: ModelInfo): void {
  setCurrentVisionModel(modelInfo);
}

export function clearVisionModel(): void {
  clearCurrentVisionModel();
}

export async function describeImage(
  imageFilePart: FilePartInput,
  userPrompt: string,
  directory: string,
  parentSessionId?: string,
): Promise<string> {
  const visionModel = getStoredVisionModel();
  if (!visionModel) {
    throw new Error("Vision model is not configured");
  }

  const createResult = await opencodeClient.session.create({
    directory,
    title: "vision-image-description",
    ...(parentSessionId ? { parentID: parentSessionId } : {}),
  });

  if (createResult.error || !createResult.data) {
    throw new Error(
      `Failed to create vision session: ${JSON.stringify(createResult.error ?? "no session returned")}`,
    );
  }

  const sessionId = createResult.data.id;

  try {
    const descriptionPrompt = userPrompt.trim().length > 0
      ? `The user asked: "${userPrompt}"\n\nPlease describe the uploaded image in detail, focusing on the aspects most relevant to answering the user's question.`
      : "Please describe this image in detail.";

    const promptResult = await opencodeClient.session.prompt({
      sessionID: sessionId,
      directory,
      model: {
        providerID: visionModel.providerID,
        modelID: visionModel.modelID,
      },
      parts: [
        { type: "text", text: descriptionPrompt },
        imageFilePart,
      ],
    });

    if (promptResult.error || !promptResult.data) {
      throw new Error(
        `Vision model prompt failed: ${JSON.stringify(promptResult.error ?? "no response")}`,
      );
    }

    const text = promptResult.data.parts
      .filter((p): p is TextPart => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new Error("Vision model returned no text description");
    }

    return text;
  } finally {
    opencodeClient.session.delete({ sessionID: sessionId, directory }).catch((err) => {
      logger.warn("[VisionModel] Failed to delete temporary session:", err);
    });
  }
}
