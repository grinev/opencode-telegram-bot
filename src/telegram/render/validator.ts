import type { MessageEntity } from "grammy/types";

export interface EntityValidationIssue {
  code: string;
  message: string;
  entityIndex?: number;
}

export interface EntityValidationResult {
  ok: boolean;
  issues: EntityValidationIssue[];
}

const SUPPORTED_ENTITY_TYPES = new Set<MessageEntity["type"]>([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "spoiler",
  "code",
  "pre",
  "text_link",
]);

const STYLE_ENTITY_TYPES = new Set<MessageEntity["type"]>([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "spoiler",
]);

function getRange(entity: MessageEntity): { start: number; end: number } {
  return {
    start: entity.offset,
    end: entity.offset + entity.length,
  };
}

function rangesEqual(left: MessageEntity, right: MessageEntity): boolean {
  return left.offset === right.offset && left.length === right.length;
}

function rangesOverlap(left: MessageEntity, right: MessageEntity): boolean {
  const leftRange = getRange(left);
  const rightRange = getRange(right);
  return leftRange.start < rightRange.end && rightRange.start < leftRange.end;
}

function isFullyNested(left: MessageEntity, right: MessageEntity): boolean {
  const leftRange = getRange(left);
  const rightRange = getRange(right);
  return leftRange.start <= rightRange.start && leftRange.end >= rightRange.end;
}

function isPartialOverlap(left: MessageEntity, right: MessageEntity): boolean {
  if (!rangesOverlap(left, right) || rangesEqual(left, right)) {
    return false;
  }

  return !isFullyNested(left, right) && !isFullyNested(right, left);
}

function isStyleEntity(entity: MessageEntity): boolean {
  return STYLE_ENTITY_TYPES.has(entity.type);
}

function isLoopbackHttpHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)]$/, "$1").replace(/\.$/, "");

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("127.") ||
    normalized === "::1"
  );
}

export function isLoopbackTelegramHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) && isLoopbackHttpHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function isValidTelegramTextLinkUrl(url: string): boolean {
  if (/\s/.test(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:", "tg:", "mailto:"].includes(parsed.protocol)) {
      return false;
    }

    if (["http:", "https:"].includes(parsed.protocol)) {
      return Boolean(parsed.hostname) && !isLoopbackTelegramHttpUrl(url);
    }

    return true;
  } catch {
    return false;
  }
}

function validateEntityShape(
  textLength: number,
  entity: MessageEntity,
  entityIndex: number,
): EntityValidationIssue[] {
  const issues: EntityValidationIssue[] = [];

  if (!SUPPORTED_ENTITY_TYPES.has(entity.type)) {
    issues.push({
      code: "unsupported_entity_type",
      message: `Unsupported Telegram entity type: ${entity.type}`,
      entityIndex,
    });
  }

  if (!Number.isInteger(entity.offset) || entity.offset < 0) {
    issues.push({
      code: "invalid_offset",
      message: `Entity offset must be a non-negative integer, got ${entity.offset}`,
      entityIndex,
    });
  }

  if (!Number.isInteger(entity.length) || entity.length <= 0) {
    issues.push({
      code: "invalid_length",
      message: `Entity length must be a positive integer, got ${entity.length}`,
      entityIndex,
    });
  }

  if (entity.offset + entity.length > textLength) {
    issues.push({
      code: "range_out_of_bounds",
      message: `Entity range ${entity.offset}-${entity.offset + entity.length} exceeds text length ${textLength}`,
      entityIndex,
    });
  }

  if (entity.type === "text_link" && !isValidTelegramTextLinkUrl(entity.url)) {
    issues.push({
      code: "invalid_link_url",
      message: `Invalid Telegram text_link URL: ${entity.url}`,
      entityIndex,
    });
  }

  return issues;
}

function validateEntityPair(
  left: MessageEntity,
  leftIndex: number,
  right: MessageEntity,
  rightIndex: number,
): EntityValidationIssue[] {
  const issues: EntityValidationIssue[] = [];

  if (!rangesOverlap(left, right)) {
    return issues;
  }

  if (left.type === right.type && rangesEqual(left, right)) {
    issues.push({
      code: "duplicate_entity_range",
      message: `Duplicate ${left.type} entities share the same range ${left.offset}-${left.offset + left.length}`,
      entityIndex: rightIndex,
    });
    return issues;
  }

  if (isPartialOverlap(left, right)) {
    issues.push({
      code: "partial_overlap",
      message: `Entities ${left.type} and ${right.type} partially overlap`,
      entityIndex: rightIndex,
    });
    return issues;
  }

  if (
    left.type === "code" ||
    right.type === "code" ||
    left.type === "pre" ||
    right.type === "pre"
  ) {
    issues.push({
      code: left.type === "pre" || right.type === "pre" ? "pre_overlap" : "code_overlap",
      message: `${left.type === "pre" || right.type === "pre" ? "Pre" : "Code"} entities cannot overlap with ${left.type === "code" || left.type === "pre" ? right.type : left.type}`,
      entityIndex: left.type === "code" || left.type === "pre" ? rightIndex : leftIndex,
    });
    return issues;
  }

  if (left.type === "text_link" && right.type === "text_link") {
    issues.push({
      code: "nested_link",
      message: "text_link entities cannot be nested or share the same range",
      entityIndex: rightIndex,
    });
    return issues;
  }

  const styleAndLinkNestingAllowed =
    (left.type === "text_link" && isStyleEntity(right)) ||
    (right.type === "text_link" && isStyleEntity(left));

  if (!styleAndLinkNestingAllowed && !(isStyleEntity(left) && isStyleEntity(right))) {
    issues.push({
      code: "unsupported_overlap",
      message: `Unsupported overlap between ${left.type} and ${right.type}`,
      entityIndex: rightIndex,
    });
  }

  return issues;
}

export function validateTelegramEntities(
  text: string,
  entities: MessageEntity[],
): EntityValidationResult {
  const issues: EntityValidationIssue[] = [];
  const textLength = text.length;

  entities.forEach((entity, entityIndex) => {
    issues.push(...validateEntityShape(textLength, entity, entityIndex));
  });

  for (let leftIndex = 0; leftIndex < entities.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < entities.length; rightIndex++) {
      issues.push(
        ...validateEntityPair(entities[leftIndex], leftIndex, entities[rightIndex], rightIndex),
      );
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
