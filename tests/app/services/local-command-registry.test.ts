import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "#vitest";
import { LocalCommandRegistry } from "../../../src/app/services/local-command-registry.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("LocalCommandRegistry", () => {
  it("loads valid commands in filename order and skips collisions", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "otb-local-commands-"));
    directories.push(directory);
    await writeFile(path.join(directory, "zeta.json"), '{"description":"Zeta","exec":"echo zeta"}');
    await writeFile(path.join(directory, "alpha.json"), '{"description":"Alpha","exec":"echo alpha","allowWhenBusy":true,"future":1}');
    await writeFile(path.join(directory, "start.json"), '{"description":"Built-in","exec":"echo no"}');

    const registry = await LocalCommandRegistry.load({ directoryPath: directory, builtInCommands: ["start"] });

    expect(registry.definitions()).toEqual([
      { command: "alpha", description: "Alpha", allowWhenBusy: true },
      { command: "zeta", description: "Zeta", allowWhenBusy: false },
    ]);
    expect(registry.allowsWhenBusy("/alpha")).toBe(true);
  });

  it("returns an empty registry when the directory is absent", async () => {
    const registry = await LocalCommandRegistry.load({
      directoryPath: path.join(os.tmpdir(), "otb-local-commands-missing"),
      builtInCommands: ["start"],
    });

    expect(registry.definitions()).toEqual([]);
  });
});
