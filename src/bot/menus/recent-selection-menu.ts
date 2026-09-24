import { InlineKeyboard } from "grammy";
import { getProjectFolderName } from "./project-selection-menu.js";
import type { RecentSession, RecentStatus } from "../../app/services/recent-sessions-service.js";
import { t } from "../../i18n/index.js";

export const RECENT_CALLBACK_PREFIX = "recent:";
const GLYPHS: Record<RecentStatus, string> = {
  running: "⏳", idle: "○", question: "❓", permission: "🔐",
};

function shortenProject(name: string): string {
  if ([...name].length <= 40) return name;
  const segments = name.split("/");
  const shorten = (segment: string, max: number, tail = Math.floor((max - 1) / 2)) => {
    const chars = [...segment];
    return chars.length <= max ? segment
      : `${chars.slice(0, max - tail - 1).join("")}…${chars.slice(-tail).join("")}`;
  };
  if (segments.length === 1) return shorten(name, 40);
  const first = shorten(segments[0]!, 24, 18);
  const last = shorten(segments.at(-1)!, segments.length === 2 ? 15 : 13);
  return segments.length === 2 ? `${first}/${last}` : `${first}/…/${last}`;
}

function projectLabels(names: string[]): string[] {
  const shortened = names.map(shortenProject);
  return names.map((name, index) => {
    if (!shortened.some((other, otherIndex) => otherIndex !== index && other === shortened[index] && names[otherIndex] !== name)) {
      return shortened[index]!;
    }
    const parent = name.slice(0, name.lastIndexOf("/"));
    const others = names.filter((other) => other !== name);
    const folder = shortenProject(name.split("/").at(-1) ?? name).slice(0, 12);
    for (const other of others) {
      let difference = 0;
      while (difference < parent.length && parent[difference] === other[difference]) difference++;
      const start = Math.max(0, difference - 8);
      const excerpt = parent.slice(start, start + 22);
      if (excerpt && others.every((candidate) => !candidate.includes(excerpt))) {
        return `…${excerpt}…/${folder}`;
      }
    }
    for (let size = Math.min(22, parent.length); size > 0; size--) {
      for (let start = parent.length - size; start >= 0; start--) {
        const excerpt = parent.slice(start, start + size);
        if (others.every((other) => !other.includes(excerpt))) {
          return `…${excerpt}…/${folder}`;
        }
      }
    }
    return `${shortened[index]!.slice(0, 34)}…${index + 1}`;
  });
}

function projectNames(rows: RecentSession[]): string[] {
  const directories = [...new Set(rows.map(({ session }) => session.directory))];
  const parts = directories.map((directory) => directory.split(/[\\/]/).filter(Boolean));
  const names = new Map<string, string>();
  for (let i = 0; i < directories.length; i++) {
    const segments = parts[i] ?? [];
    let depth = 1;
    while (depth < segments.length && parts.some((other, index) =>
      index !== i && other.slice(-depth).join("/") === segments.slice(-depth).join("/"))) depth++;
    names.set(directories[i]!, depth === 1 ? getProjectFolderName(directories[i]!) : segments.slice(-depth).join("/"));
  }
  return rows.map(({ session }) => names.get(session.directory) ?? getProjectFolderName(session.directory));
}

export function buildRecentMenu(rows: RecentSession[]): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();
  const names = projectLabels(projectNames(rows));
  rows.forEach(({ session, status }, index) => {
    const project = names[index] ?? "";
    const prefix = `${GLYPHS[status]} [${project}] `;
    const available = Math.max(0, 64 - [...prefix].length);
    const title = [...session.title];
    const trimmed = title.length > available
      ? `${title.slice(0, Math.max(0, available - 1)).join("")}…`
      : session.title;
    keyboard.text(`${prefix}${trimmed}`, `${RECENT_CALLBACK_PREFIX}${index}`).row();
  });
  return {
    text: [t("recent.heading"), "", `⏳ ${t("recent.running")} · ○ ${t("recent.idle")} · ❓ ${t("recent.question")} · 🔐 ${t("recent.permission")}`].join("\n"),
    keyboard,
  };
}
