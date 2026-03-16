import { opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";
import type { ParsedTaskSchedule } from "./types.js";

const SCHEDULE_PARSE_SESSION_TITLE = "Scheduled task schedule parser";

function getLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDatetime(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isValidTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function extractJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Empty schedule parser response");
  }

  const directCandidates = [trimmed];
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    directCandidates.unshift(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    directCandidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of directCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("Schedule parser returned invalid JSON");
}

function validateParsedSchedule(value: unknown): ParsedTaskSchedule {
  if (!isRecord(value)) {
    throw new Error("Schedule parser returned an invalid payload");
  }

  const kind = value.kind;
  const summary = value.summary;
  const timezone = value.timezone;
  const nextRunAt = value.nextRunAt;

  if (typeof summary !== "string" || !summary.trim()) {
    throw new Error("Schedule summary is missing");
  }

  if (!isValidTimezone(timezone)) {
    throw new Error("Schedule timezone is invalid");
  }

  if (!isValidIsoDatetime(nextRunAt)) {
    throw new Error("Schedule nextRunAt is invalid");
  }

  if (kind === "cron") {
    if (typeof value.cron !== "string" || !value.cron.trim()) {
      throw new Error("Schedule cron expression is missing");
    }

    return {
      kind,
      cron: value.cron,
      timezone,
      summary: summary.trim(),
      nextRunAt,
    };
  }

  if (kind === "once") {
    if (!isValidIsoDatetime(value.runAt)) {
      throw new Error("Schedule runAt is invalid");
    }

    return {
      kind,
      runAt: value.runAt,
      timezone,
      summary: summary.trim(),
      nextRunAt,
    };
  }

  throw new Error("Schedule kind is invalid");
}

function parseSchedulePayload(rawText: string): ParsedTaskSchedule {
  const payload = extractJsonPayload(rawText);

  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
    throw new Error(payload.error.trim());
  }

  return validateParsedSchedule(payload);
}

function collectResponseText(
  parts: Array<{ type?: string; text?: string; ignored?: boolean }>,
): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && !part.ignored)
    .map((part) => part.text)
    .join("")
    .trim();
}

function buildSchedulePrompt(scheduleText: string, timezone: string): string {
  const now = new Date().toISOString();

  return [
    "Parse the following natural-language task schedule and return JSON only.",
    "Do not use markdown, explanations, code fences, or any extra text.",
    `Assume the default timezone is ${timezone}.`,
    `Current date/time reference: ${now}.`,
    "Supported interpretations include recurring schedules and one-time schedules.",
    "If parsing succeeds, return exactly one JSON object with keys: kind, timezone, summary, nextRunAt, and either cron or runAt.",
    'Use kind="cron" for recurring schedules and kind="once" for one-time schedules.',
    "summary must be a concise human-readable description in the same language as the input.",
    "nextRunAt and runAt must be ISO 8601 timestamps with timezone offset.",
    'If parsing fails or input is ambiguous, return {"error":"short explanation"}.',
    "",
    `Input: ${scheduleText}`,
  ].join("\n");
}

export async function parseTaskSchedule(
  scheduleText: string,
  directory: string,
): Promise<ParsedTaskSchedule> {
  const trimmedScheduleText = scheduleText.trim();
  if (!trimmedScheduleText) {
    throw new Error("Schedule text is empty");
  }

  const trimmedDirectory = directory.trim();
  if (!trimmedDirectory) {
    throw new Error("Schedule parser directory is empty");
  }

  const timezone = getLocalTimezone();
  let sessionId: string | null = null;

  try {
    const { data: session, error: createError } = await opencodeClient.session.create({
      directory: trimmedDirectory,
      title: SCHEDULE_PARSE_SESSION_TITLE,
    });

    if (createError || !session) {
      throw createError || new Error("Failed to create temporary schedule parser session");
    }

    sessionId = session.id;

    const { data: response, error: promptError } = await opencodeClient.session.prompt({
      sessionID: session.id,
      directory: session.directory,
      system:
        "You are a schedule parser. Your only job is to convert user schedule text into strict JSON output.",
      parts: [{ type: "text", text: buildSchedulePrompt(trimmedScheduleText, timezone) }],
    });

    if (promptError || !response) {
      throw promptError || new Error("Failed to parse schedule");
    }

    const responseText = collectResponseText(response.parts);
    if (!responseText) {
      throw new Error("Schedule parser returned an empty response");
    }

    return parseSchedulePayload(responseText);
  } finally {
    if (sessionId) {
      try {
        await opencodeClient.session.delete({ sessionID: sessionId });
      } catch (error) {
        logger.warn(
          `[ScheduledTaskScheduleParser] Failed to delete temporary session: sessionId=${sessionId}`,
          error,
        );
      }
    }
  }
}
