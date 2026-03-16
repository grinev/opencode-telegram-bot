import type { ScheduledTask } from "./types.js";

const BADGE_DATE_LOCALE = "en-US";
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface CronParts {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

interface ZonedDateParts {
  year: number;
  month: string;
  day: number;
  hour: number;
  minute: number;
}

const zonedDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();
const zonedYearFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedDateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zonedDateTimeFormatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(BADGE_DATE_LOCALE, {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });

  zonedDateTimeFormatterCache.set(timezone, formatter);
  return formatter;
}

function getZonedYearFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zonedYearFormatterCache.get(timezone);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat(BADGE_DATE_LOCALE, {
    timeZone: timezone,
    year: "numeric",
  });

  zonedYearFormatterCache.set(timezone, formatter);
  return formatter;
}

function getDateTimePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function getZonedDateParts(date: Date, timezone: string): ZonedDateParts | null {
  const parts = getZonedDateTimeFormatter(timezone).formatToParts(date);
  const year = Number.parseInt(getDateTimePart(parts, "year"), 10);
  const month = getDateTimePart(parts, "month");
  const day = Number.parseInt(getDateTimePart(parts, "day"), 10);
  const hour = Number.parseInt(getDateTimePart(parts, "hour"), 10);
  const minute = Number.parseInt(getDateTimePart(parts, "minute"), 10);

  if (
    !Number.isInteger(year) ||
    !month ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
  };
}

function padNumber(value: number): string {
  return value.toString().padStart(2, "0");
}

function formatTime(hour: number, minute: number): string {
  return `${padNumber(hour)}:${padNumber(minute)}`;
}

function formatOnceTaskBadge(runAt: string, timezone: string): string {
  const runAtDate = new Date(runAt);
  if (Number.isNaN(runAtDate.getTime())) {
    return runAt;
  }

  const runAtParts = getZonedDateParts(runAtDate, timezone);
  if (!runAtParts) {
    return runAt;
  }

  const currentYear = getZonedYearFormatter(timezone).format(new Date());
  const includeYear = currentYear !== String(runAtParts.year);
  const dateLabel = includeYear
    ? `${runAtParts.day} ${runAtParts.month} ${runAtParts.year}`
    : `${runAtParts.day} ${runAtParts.month}`;

  return `${dateLabel} ${formatTime(runAtParts.hour, runAtParts.minute)}`;
}

function parseCronParts(cron: string): CronParts | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
  };
}

function parseExactNumber(field: string, min: number, max: number): number | null {
  const trimmedField = field.trim();
  if (!/^\d+$/.test(trimmedField)) {
    return null;
  }

  const value = Number.parseInt(trimmedField, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }

  return value;
}

function parseEveryStep(field: string, minStep: number, maxStep: number): number | null {
  const match = field.trim().match(/^\*\/(\d+)$/);
  if (!match) {
    return null;
  }

  const step = Number.parseInt(match[1], 10);
  if (!Number.isInteger(step) || step < minStep || step > maxStep) {
    return null;
  }

  return step;
}

function normalizeWeekdayValue(token: string): number | null {
  const normalized = token.trim().toLowerCase();
  const aliases: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  if (normalized in aliases) {
    return aliases[normalized];
  }

  const numericValue = parseExactNumber(normalized, 0, 7);
  if (numericValue === null) {
    return null;
  }

  return numericValue === 7 ? 0 : numericValue;
}

function parseWeekdaySet(field: string): Set<number> | null {
  const values = new Set<number>();

  for (const token of field.split(",")) {
    const trimmedToken = token.trim();
    if (!trimmedToken || trimmedToken.includes("/")) {
      return null;
    }

    if (trimmedToken.includes("-")) {
      const [startRaw, endRaw] = trimmedToken.split("-");
      const start = normalizeWeekdayValue(startRaw);
      const end = normalizeWeekdayValue(endRaw);
      if (start === null || end === null || start > end) {
        return null;
      }

      for (let value = start; value <= end; value += 1) {
        values.add(value);
      }

      continue;
    }

    const value = normalizeWeekdayValue(trimmedToken);
    if (value === null) {
      return null;
    }

    values.add(value);
  }

  return values;
}

function hasExactValues(values: Set<number>, expectedValues: number[]): boolean {
  return (
    values.size === expectedValues.length && expectedValues.every((value) => values.has(value))
  );
}

function formatCronTaskBadge(cron: string): string {
  const parts = parseCronParts(cron);
  if (!parts) {
    return "cron";
  }

  const minute = parseExactNumber(parts.minute, 0, 59);
  const hour = parseExactNumber(parts.hour, 0, 23);
  const everyMinuteStep = parseEveryStep(parts.minute, 1, 59);
  const everyHourStep = parseEveryStep(parts.hour, 1, 23);
  const monthIsWildcard = parts.month === "*";
  const dayOfMonthIsWildcard = parts.dayOfMonth === "*";
  const dayOfWeekIsWildcard = parts.dayOfWeek === "*";

  if (
    everyMinuteStep !== null &&
    parts.hour === "*" &&
    monthIsWildcard &&
    dayOfMonthIsWildcard &&
    dayOfWeekIsWildcard
  ) {
    return `${everyMinuteStep}m`;
  }

  if (
    minute !== null &&
    everyHourStep !== null &&
    monthIsWildcard &&
    dayOfMonthIsWildcard &&
    dayOfWeekIsWildcard
  ) {
    return minute === 0 ? `${everyHourStep}h` : `${everyHourStep}h :${padNumber(minute)}`;
  }

  if (
    minute !== null &&
    parts.hour === "*" &&
    monthIsWildcard &&
    dayOfMonthIsWildcard &&
    dayOfWeekIsWildcard
  ) {
    return minute === 0 ? "hourly" : `hourly :${padNumber(minute)}`;
  }

  if (
    minute !== null &&
    hour !== null &&
    monthIsWildcard &&
    dayOfMonthIsWildcard &&
    dayOfWeekIsWildcard
  ) {
    return `daily ${formatTime(hour, minute)}`;
  }

  if (minute !== null && hour !== null && monthIsWildcard && dayOfMonthIsWildcard) {
    const weekdayValues = parseWeekdaySet(parts.dayOfWeek);
    if (!weekdayValues) {
      return "cron";
    }

    if (hasExactValues(weekdayValues, [1, 2, 3, 4, 5])) {
      return `weekdays ${formatTime(hour, minute)}`;
    }

    if (hasExactValues(weekdayValues, [0, 6])) {
      return `weekends ${formatTime(hour, minute)}`;
    }

    if (weekdayValues.size === 1) {
      const [weekday] = weekdayValues;
      return `${WEEKDAY_LABELS[weekday]} ${formatTime(hour, minute)}`;
    }
  }

  const dayOfMonth = parseExactNumber(parts.dayOfMonth, 1, 31);
  if (
    minute !== null &&
    hour !== null &&
    dayOfMonth !== null &&
    monthIsWildcard &&
    dayOfWeekIsWildcard
  ) {
    return `monthly ${dayOfMonth} ${formatTime(hour, minute)}`;
  }

  return "cron";
}

export function formatTaskListBadge(task: ScheduledTask): string {
  if (task.kind === "once") {
    return formatOnceTaskBadge(task.runAt, task.timezone);
  }

  return formatCronTaskBadge(task.cron);
}
