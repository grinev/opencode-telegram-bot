import { Context, InputFile } from "grammy";
import { promises as fs } from "node:fs";
import path from "node:path";
import { formatFileSize } from "./file-download.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

const MAX_FILE_SIZE_MB = 50;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendDownloadedFile(
  ctx: Context,
  filePath: string,
  options?: { announce?: boolean },
): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) {
      await ctx.reply(`❌ ${t("commands.download.not_found")}: <code>${escapeHtml(filePath)}</code>`, {
        parse_mode: "HTML",
      });
      return false;
    }

    if (!stat.isFile()) {
      await ctx.reply(`❌ ${t("commands.download.not_file")}: <code>${escapeHtml(filePath)}</code>`, {
        parse_mode: "HTML",
      });
      return false;
    }

    if (stat.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      await ctx.reply(
        `❌ ${t("commands.download.file_too_large")}: ${formatFileSize(stat.size)} (max: ${MAX_FILE_SIZE_MB}MB)`,
      );
      return false;
    }

    const fileName = path.basename(filePath);

    if (options?.announce !== false) {
      await ctx.reply(`📥 ${t("commands.download.downloading")} <code>${escapeHtml(fileName)}</code>`, {
        parse_mode: "HTML",
      });
    }

    const fileContent = await fs.readFile(filePath);
    const caption =
      `📄 <code>${escapeHtml(fileName)}</code>\n` +
      `${t("commands.download.size")}: ${formatFileSize(stat.size)}\n` +
      `${t("commands.download.modified")}: ${stat.mtime.toLocaleDateString()}`;

    await ctx.replyWithDocument(new InputFile(fileContent, fileName), {
      caption: caption.slice(0, 1024),
      parse_mode: "HTML",
    });

    logger.info(`[Download] User ${ctx.from?.id} downloaded file: ${filePath}`);
    return true;
  } catch (error) {
    logger.error("[Download] Error:", error);
    await ctx.reply(`❌ ${t("commands.download.error")}`);
    return false;
  }
}
