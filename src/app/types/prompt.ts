import type { FilePartInput } from "@opencode-ai/sdk/v2";

export type TelegramPhotoSource = "standalone" | "album" | "rich";

export interface TelegramPhotoInput {
  fileId: string;
  filename: string;
  source: TelegramPhotoSource;
  fileSize?: number;
}

export interface IncomingPrompt {
  text: string;
  fileParts: FilePartInput[];
  photos: TelegramPhotoInput[];
}

export function createIncomingPrompt(
  text: string,
  options: {
    fileParts?: FilePartInput[];
    photos?: TelegramPhotoInput[];
  } = {},
): IncomingPrompt {
  return {
    text,
    fileParts: options.fileParts ?? [],
    photos: options.photos ?? [],
  };
}
