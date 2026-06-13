import { InlineKeyboard } from "grammy";
import type { SkillCatalogItem } from "../../app/services/skills-catalog-service.js";
import { t } from "../../i18n/index.js";

export const SKILLS_CALLBACK_PREFIX = "skills:";
export const SKILLS_CALLBACK_SELECT_PREFIX = `${SKILLS_CALLBACK_PREFIX}select:`;
const SKILLS_CALLBACK_PAGE_PREFIX = `${SKILLS_CALLBACK_PREFIX}page:`;
export const SKILLS_CALLBACK_CANCEL = `${SKILLS_CALLBACK_PREFIX}cancel`;
export const SKILLS_CALLBACK_EXECUTE = `${SKILLS_CALLBACK_PREFIX}execute`;

const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;

interface ExecutingSkillMessage {
  text: string;
  entities: Array<{
    type: "code";
    offset: number;
    length: number;
  }>;
}

export interface SkillsPaginationRange {
  page: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export function formatExecutingSkillMessage(skillName: string, args: string): ExecutingSkillMessage {
  const prefix = t("skills.executing_prefix");
  const skillText = `/${skillName}`;
  const argsSuffix = args ? ` ${args}` : "";
  return {
    text: `${prefix}\n${skillText}${argsSuffix}`,
    entities: [
      {
        type: "code",
        offset: prefix.length + 1,
        length: skillText.length,
      },
    ],
  };
}

export function buildSkillPageCallback(page: number): string {
  return `${SKILLS_CALLBACK_PAGE_PREFIX}${page}`;
}

export function parseSkillPageCallback(data: string): number | null {
  if (!data.startsWith(SKILLS_CALLBACK_PAGE_PREFIX)) {
    return null;
  }

  const rawPage = data.slice(SKILLS_CALLBACK_PAGE_PREFIX.length);
  const page = Number(rawPage);
  if (!Number.isInteger(page) || page < 0) {
    return null;
  }

  return page;
}

export function parseSkillSelectCallback(data: string): number | null {
  if (!data.startsWith(SKILLS_CALLBACK_SELECT_PREFIX)) {
    return null;
  }

  const rawIndex = data.slice(SKILLS_CALLBACK_SELECT_PREFIX.length);
  const index = Number(rawIndex);

  if (!Number.isInteger(index) || index < 0) {
    return null;
  }

  return index;
}

export function formatSkillsSelectText(page: number): string {
  if (page === 0) {
    return t("skills.select");
  }

  return t("skills.select_page", { page: page + 1 });
}

function formatSkillButtonLabel(skill: SkillCatalogItem): string {
  const description = skill.description?.trim() || t("skills.no_description");
  const rawLabel = `/${skill.name} - ${description}`;

  if (rawLabel.length <= MAX_INLINE_BUTTON_LABEL_LENGTH) {
    return rawLabel;
  }

  return `${rawLabel.slice(0, MAX_INLINE_BUTTON_LABEL_LENGTH - 3)}...`;
}

export function calculateSkillsPaginationRange(
  totalSkills: number,
  page: number,
  pageSize: number,
): SkillsPaginationRange {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(totalSkills / safePageSize));
  const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
  const startIndex = normalizedPage * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalSkills);

  return {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  };
}

export function buildSkillsListKeyboard(
  skills: SkillCatalogItem[],
  page: number,
  pageSize: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const {
    page: normalizedPage,
    totalPages,
    startIndex,
    endIndex,
  } = calculateSkillsPaginationRange(skills.length, page, pageSize);

  skills.slice(startIndex, endIndex).forEach((skill, index) => {
    const globalIndex = startIndex + index;
    keyboard.text(formatSkillButtonLabel(skill), `${SKILLS_CALLBACK_SELECT_PREFIX}${globalIndex}`).row();
  });

  if (totalPages > 1) {
    if (normalizedPage > 0) {
      keyboard.text(t("skills.button.prev_page"), buildSkillPageCallback(normalizedPage - 1));
    }

    if (normalizedPage < totalPages - 1) {
      keyboard.text(t("skills.button.next_page"), buildSkillPageCallback(normalizedPage + 1));
    }

    keyboard.row();
  }

  keyboard.text(t("skills.button.cancel"), SKILLS_CALLBACK_CANCEL);
  return keyboard;
}

export function buildSkillsConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("skills.button.execute"), SKILLS_CALLBACK_EXECUTE)
    .text(t("skills.button.cancel"), SKILLS_CALLBACK_CANCEL);
}
