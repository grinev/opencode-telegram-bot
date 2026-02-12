#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SECTION_ORDER = [
  "Major Changes",
  "Changes",
  "Bug Fixes",
  "Technical",
  "Documentation",
  "Other",
];

const TECHNICAL_TYPES = new Set(["refactor", "chore", "ci", "build", "test", "style"]);

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[i + 1];

    if (!value || value.startsWith("--")) {
      process.stderr.write(`Missing value for --${key}\n`);
      process.exit(2);
    }

    args[key] = value;
    i += 1;
  }

  return args;
}

function runGit(args, optional = false) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (optional) {
      return "";
    }

    throw error;
  }
}

function normalizeText(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return "Uncategorized change.";
  }

  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function isReleaseCommit(subject) {
  return /^chore\(release\):\s*v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/i.test(subject.trim());
}

function classifyCommit(subject) {
  const line = subject.trim();
  const conventionalMatch = line.match(/^([a-z]+)(\([^)]*\))?(!)?:\s*(.+)$/i);

  if (!conventionalMatch) {
    return { section: "Other", text: normalizeText(line) };
  }

  const type = conventionalMatch[1].toLowerCase();
  const hasBang = Boolean(conventionalMatch[3]);
  const description = normalizeText(conventionalMatch[4]);

  if (hasBang) {
    if (type === "feat") {
      return { section: "Major Changes", text: description };
    }

    return { section: "Other", text: description };
  }

  if (type === "feat" || type === "perf") {
    return { section: "Changes", text: description };
  }

  if (type === "fix" || type === "revert") {
    return { section: "Bug Fixes", text: description };
  }

  if (TECHNICAL_TYPES.has(type)) {
    return { section: "Technical", text: description };
  }

  if (type === "docs") {
    return { section: "Documentation", text: description };
  }

  return { section: "Other", text: description };
}

function createEmptySections() {
  const sections = {};

  for (const section of SECTION_ORDER) {
    sections[section] = [];
  }

  return sections;
}

function sortByCommitTime(items) {
  return [...items].sort((left, right) => {
    if (left.timestamp === right.timestamp) {
      return left.order - right.order;
    }

    return left.timestamp - right.timestamp;
  });
}

function buildTitle(version, kind) {
  if (kind === "rc") {
    return `## Release Candidate v${version}`;
  }

  return `## Release v${version}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.version;
  const kind = args.kind;
  const repository = args.repo;
  const outputPath = args.output;

  if (!version || !kind || !repository || !outputPath) {
    process.stderr.write(
      "Usage: node scripts/generate-release-notes.mjs --version <version> --kind <stable|rc> --repo <owner/repo> --output <path>\n",
    );
    process.exit(2);
  }

  const lastTag = runGit(["describe", "--tags", "--abbrev=0", "HEAD^"], true);
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const logOutput = runGit(["log", "--no-merges", "--pretty=format:%ct%x09%s", range], true);

  const commits = logOutput
    ? logOutput
        .split(/\r?\n/)
        .map((line) => {
          const tabIndex = line.indexOf("\t");

          if (tabIndex === -1) {
            return {
              timestamp: 0,
              subject: line.trim(),
            };
          }

          const timestamp = Number.parseInt(line.slice(0, tabIndex), 10);
          const subject = line.slice(tabIndex + 1).trim();

          return {
            timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
            subject,
          };
        })
        .filter((entry) => entry.subject.length > 0)
        .filter((entry) => !isReleaseCommit(entry.subject))
    : [];

  const sections = createEmptySections();

  commits.forEach((commit, index) => {
    const { section, text } = classifyCommit(commit.subject);
    sections[section].push({
      text,
      timestamp: commit.timestamp,
      order: index,
    });
  });

  const lines = [buildTitle(version, kind), ""];

  let hasRenderedSections = false;

  for (const section of SECTION_ORDER) {
    const items = sections[section];
    if (items.length === 0) {
      continue;
    }

    hasRenderedSections = true;
    lines.push(`### ${section}`);

    for (const item of sortByCommitTime(items)) {
      lines.push(`- ${item.text}`);
    }

    lines.push("");
  }

  if (!hasRenderedSections) {
    lines.push("- Maintenance release.", "");
  }

  const compareFrom = lastTag || "<previous-tag>";
  lines.push(
    `Full changelog: https://github.com/${repository}/compare/${compareFrom}...v${version}`,
  );

  const content = `${lines.join("\n").trimEnd()}\n`;
  writeFileSync(outputPath, content, "utf8");
}

main();
