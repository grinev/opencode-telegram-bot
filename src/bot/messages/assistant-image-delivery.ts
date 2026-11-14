import { InputFile } from "grammy";
import type { InputRichMessage } from "grammy/types";
import {
  readAssistantImage,
  type AssistantImageFailure,
} from "../../app/services/assistant-image-service.js";
import { t } from "../../i18n/index.js";
import { getImageDescriptor } from "../render/image-descriptor.js";
import { countRichMedia } from "../render/rich-blocks.js";
import type { TelegramRenderedPart, TelegramRichBlock } from "../render/types.js";
import { isTelegramBadRequestError } from "./send-with-markdown-fallback.js";

type UploadBlock = NonNullable<InputRichMessage["blocks"]>[number];
interface ResolvedPhoto {
  block: UploadBlock;
  name: string;
}

export function hasDeferredImages(part: TelegramRenderedPart): boolean {
  return part.blocks.some((block) => countRichMedia(block) > 0);
}

async function imageBlocks(
  blocks: TelegramRichBlock[],
  directory: string | undefined,
  photos: ResolvedPhoto[],
): Promise<UploadBlock[]> {
  const output: UploadBlock[] = [];
  for (const block of blocks) {
    const image = getImageDescriptor(block);
    if (image) {
      const result = await readAssistantImage(directory, image.path);
      if ("reason" in result) {
        output.push({
          type: "paragraph",
          text: t(`assistant.image.${result.reason}`, { name: image.name }),
        });
      } else {
        const photo: UploadBlock = {
          type: "photo",
          photo: { type: "photo", media: new InputFile(result.bytes, result.filename) },
        };
        output.push(photo);
        photos.push({ block: photo, name: image.name });
      }
    } else if (block.type === "blockquote" || block.type === "details") {
      output.push({ ...block, blocks: await imageBlocks(block.blocks, directory, photos) });
    } else if (block.type === "list") {
      const items = [];
      for (const item of block.items)
        items.push({ ...item, blocks: await imageBlocks(item.blocks, directory, photos) });
      output.push({ ...block, items });
    } else {
      output.push(block);
    }
  }
  return output;
}

function sendFailure(error: unknown): AssistantImageFailure {
  return /too (?:large|big)|dimensions|PHOTO_INVALID_DIMENSIONS|FILE_TOO_BIG|PHOTO_SIZE/i.test(
    String(error),
  )
    ? "too_large"
    : "unavailable";
}

function replaceRejectedPhotos(
  blocks: UploadBlock[],
  notices: Map<UploadBlock, UploadBlock>,
): UploadBlock[] {
  return blocks.map((block) => {
    const notice = notices.get(block);
    if (notice) return notice;
    if (block.type === "blockquote" || block.type === "details") {
      return { ...block, blocks: replaceRejectedPhotos(block.blocks, notices) };
    }
    if (block.type === "list") {
      return {
        ...block,
        items: block.items.map((item) => ({
          ...item,
          blocks: replaceRejectedPhotos(item.blocks, notices),
        })),
      };
    }
    return block;
  });
}

export async function deliverAssistantImagePart<T>(
  part: TelegramRenderedPart,
  send: (blocks: UploadBlock[]) => Promise<T>,
  edit?: (sent: T, blocks: UploadBlock[]) => Promise<unknown>,
): Promise<T> {
  const check = (): void => {
    if (part.canDeliver && !part.canDeliver())
      throw new Error("Assistant image delivery cancelled after session change");
  };
  check();
  const photos: ResolvedPhoto[] = [];
  const blocks = await imageBlocks(part.blocks, part.imageDirectory, photos);
  check();
  try {
    return await send(blocks);
  } catch (error) {
    // A definite 400 did not deliver the rich part. Never retry an ambiguous send.
    if (!isTelegramBadRequestError(error)) throw error;
    if (photos.length === 0 || (photos.length > 1 && !edit)) throw error;
    const notice = (name: string, failure: unknown): UploadBlock => ({
      type: "paragraph",
      text: t(`assistant.image.${sendFailure(failure)}`, { name }),
    });
    const notices = new Map(photos.map((photo) => [photo.block, notice(photo.name, error)]));
    check();
    const sent = await send(replaceRejectedPhotos(blocks, notices));
    if (photos.length === 1 || !edit) return sent;
    // Restore candidates by editing the one delivered reply, never by sending
    // another message. A definite rejection affects only that candidate.
    for (const photo of photos) {
      const previousNotice = notices.get(photo.block);
      notices.delete(photo.block);
      check();
      try {
        await edit(sent, replaceRejectedPhotos(blocks, notices));
      } catch (failure) {
        if (!isTelegramBadRequestError(failure)) throw failure;
        const rejectedNotice = notice(photo.name, failure);
        notices.set(photo.block, rejectedNotice);
        // The rejected edit changed nothing on screen. Only edit again when
        // its reason changed; an identical edit would be MESSAGE_NOT_MODIFIED.
        if (JSON.stringify(previousNotice) !== JSON.stringify(rejectedNotice)) {
          check();
          await edit(sent, replaceRejectedPhotos(blocks, notices));
        }
      }
    }
    return sent;
  }
}
