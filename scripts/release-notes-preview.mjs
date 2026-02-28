#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

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

function resolveRepositoryFromPackage(packageJson) {
  const repositoryField = packageJson.repository;
  const repositoryUrl =
    typeof repositoryField === "string" ? repositoryField : repositoryField && repositoryField.url;

  if (!repositoryUrl || typeof repositoryUrl !== "string") {
    return "";
  }

  const match = repositoryUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return match ? match[1] : "";
}

function resolveKind(version) {
  return /-rc\.\d+$/i.test(version) ? "rc" : "stable";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageJsonPath = resolve(process.cwd(), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  const version = args.version || packageJson.version;
  const kind = args.kind || resolveKind(version);
  const repository =
    args.repo || process.env.GITHUB_REPOSITORY || resolveRepositoryFromPackage(packageJson);
  const token = args.token || process.env.GITHUB_TOKEN;

  if (!version || !kind || !repository) {
    process.stderr.write(
      "Unable to resolve preview parameters. Use --version, --kind, and --repo to pass them explicitly.\n",
    );
    process.exit(2);
  }

  const outputFile = join(tmpdir(), `release-notes-preview-${Date.now()}.md`);
  const nodeCommand = process.execPath;
  const generatorScriptPath = resolve(process.cwd(), "scripts", "generate-release-notes.mjs");

  const result = spawnSync(
    nodeCommand,
    [
      generatorScriptPath,
      "--version",
      version,
      "--kind",
      kind,
      "--repo",
      repository,
      "--output",
      outputFile,
      ...(token ? ["--token", token] : []),
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  const content = readFileSync(outputFile, "utf8");
  process.stdout.write(content);
  rmSync(outputFile, { force: true });
}

main();
