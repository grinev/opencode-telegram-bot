import { logger } from "../../utils/logger.js";
import type { TelegramBlock, TelegramRenderedBlock } from "./types.js";
import * as blockRenderer from "./block-renderer.js";

const BLOCK_RENDER_ORDER = ["full", "simplified", "line-by-line", "plain"] as const;

export function renderTelegramBlockWithFallback(block: TelegramBlock): TelegramRenderedBlock {
  let lastError: unknown;
  const failures: Array<{ mode: (typeof BLOCK_RENDER_ORDER)[number]; reason: string }> = [];

  for (const mode of BLOCK_RENDER_ORDER) {
    try {
      const renderedBlock = blockRenderer.renderTelegramBlock(block, mode);
      if (failures.length > 0) {
        logger.debug("[TelegramRender] Block fallback applied", {
          blockType: block.type,
          selectedMode: renderedBlock.mode,
          failures,
        });
      }

      return renderedBlock;
    } catch (error) {
      lastError = error;
      failures.push({
        mode,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to render Telegram block");
}
