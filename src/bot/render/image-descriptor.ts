import type { TelegramBlock, TelegramRichBlock } from "./types.js";

export type ImageDescriptor = Extract<TelegramBlock, { type: "image" }>;
const PREFIX = "otb-image:";

export function imageDescriptorMedia(image: ImageDescriptor): string {
  return PREFIX + JSON.stringify(image);
}

export function getImageDescriptor(block: TelegramRichBlock): ImageDescriptor | undefined {
  if (block.type !== "photo" || !block.photo.media.startsWith(PREFIX)) {
    return undefined;
  }
  return JSON.parse(block.photo.media.slice(PREFIX.length)) as ImageDescriptor;
}
