import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRuntimeMode } from "../../../src/runtime/mode.js";
import {
  __resetSettingsForTests,
  getCompactOutputMode,
  getResponseStreamingMode,
  getSendDiffFileAttachments,
  getShowAssistantRunFooter,
  getShowThinkingContent,
  getTtsMode,
  loadSettings,
  setCompactOutputMode,
  setResponseStreamingMode,
  setSendDiffFileAttachments,
  setShowAssistantRunFooter,
  setShowThinkingContent,
} from "../../../src/app/stores/settings-store.js";

describe("app/stores/settings-store", () => {
  let tempHome: string;

  beforeEach(async () => {
    delete process.env.INITIAL_SETTINGS_PRESET;
    tempHome = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-settings-store-"));
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
    setRuntimeMode("installed");
    __resetSettingsForTests();
  });

  afterEach(async () => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    __resetSettingsForTests();
    await rm(tempHome, { recursive: true, force: true });
  });

  it.each([
    { oldValue: true, expectedMode: "all" },
    { oldValue: false, expectedMode: "off" },
  ] as const)(
    "migrates ttsEnabled=$oldValue to $expectedMode mode",
    async ({ oldValue, expectedMode }) => {
      await writeFile(
        path.join(tempHome, "settings.json"),
        JSON.stringify({ ttsEnabled: oldValue }, null, 2),
      );

      await loadSettings();

      expect(getTtsMode()).toBe(expectedMode);
    },
  );

  it("uses disabled compact output mode by default", async () => {
    await loadSettings();

    expect(getCompactOutputMode()).toBe(false);
  });

  it("loads compact output mode from settings.json", async () => {
    await writeFile(path.join(tempHome, "settings.json"), JSON.stringify({ compactOutputMode: true }));

    await loadSettings();

    expect(getCompactOutputMode()).toBe(true);
  });

  it("shows thinking content by default", async () => {
    await loadSettings();

    expect(getShowThinkingContent()).toBe(true);
  });

  it("shows assistant run footer by default", async () => {
    await loadSettings();

    expect(getShowAssistantRunFooter()).toBe(true);
  });

  it("applies INITIAL_SETTINGS_PRESET for settings not yet persisted", async () => {
    vi.resetModules();
    vi.stubEnv(
      "INITIAL_SETTINGS_PRESET",
      '{"showAssistantRunFooter":false,"compactOutputMode":true,"ttsMode":"auto","responseStreamingMode":"draft","sendDiffFileAttachments":false,"showThinkingContent":false}',
    );

    const store = await import("../../../src/app/stores/settings-store.js");
    await store.loadSettings();

    expect(store.getShowAssistantRunFooter()).toBe(false);
    expect(store.getCompactOutputMode()).toBe(true);
    expect(store.getTtsMode()).toBe("auto");
    expect(store.getResponseStreamingMode()).toBe("draft");
    expect(store.getSendDiffFileAttachments()).toBe(false);
    expect(store.getShowThinkingContent()).toBe(false);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not overwrite a persisted setting with INITIAL_SETTINGS_PRESET", async () => {
    await writeFile(
      path.join(tempHome, "settings.json"),
      JSON.stringify({ showAssistantRunFooter: true }),
    );
    vi.resetModules();
    vi.stubEnv("INITIAL_SETTINGS_PRESET", '{"showAssistantRunFooter":false}');
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", tempHome);

    const store = await import("../../../src/app/stores/settings-store.js");
    await store.loadSettings();

    expect(store.getShowAssistantRunFooter()).toBe(true);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws on unknown keys in INITIAL_SETTINGS_PRESET", async () => {
    vi.resetModules();
    vi.stubEnv("INITIAL_SETTINGS_PRESET", '{"unknownKey":true,"compactOutputMode":true}');

    await expect((async () => {
      const store = await import("../../../src/app/stores/settings-store.js");
      await store.loadSettings();
    })()).rejects.toThrow(/unknown key "unknownKey"/);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws when a preset key has the wrong type", async () => {
    vi.resetModules();
    vi.stubEnv("INITIAL_SETTINGS_PRESET", '{"compactOutputMode":"yes"}');

    await expect((async () => {
      const store = await import("../../../src/app/stores/settings-store.js");
      await store.loadSettings();
    })()).rejects.toThrow(/"compactOutputMode" must be a boolean/);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("loads thinking content setting from settings.json", async () => {
    await writeFile(path.join(tempHome, "settings.json"), JSON.stringify({ showThinkingContent: false }));

    await loadSettings();

    expect(getShowThinkingContent()).toBe(false);
  });

  it("sends diff file attachments by default", async () => {
    await loadSettings();

    expect(getSendDiffFileAttachments()).toBe(true);
  });

  it("uses edit response streaming mode by default", async () => {
    await loadSettings();

    expect(getResponseStreamingMode()).toBe("edit");
  });

  it("loads response streaming mode from settings.json", async () => {
    await writeFile(path.join(tempHome, "settings.json"), JSON.stringify({ responseStreamingMode: "draft" }));

    await loadSettings();

    expect(getResponseStreamingMode()).toBe("draft");
  });

  it("loads diff file attachment setting from settings.json", async () => {
    await writeFile(
      path.join(tempHome, "settings.json"),
      JSON.stringify({ sendDiffFileAttachments: false }),
    );

    await loadSettings();

    expect(getSendDiffFileAttachments()).toBe(false);
  });

  it("loads assistant run footer setting from settings.json", async () => {
    await writeFile(
      path.join(tempHome, "settings.json"),
      JSON.stringify({ showAssistantRunFooter: false }),
    );

    await loadSettings();

    expect(getShowAssistantRunFooter()).toBe(false);
  });

  it("persists compact output mode to settings.json", async () => {
    await loadSettings();

    setCompactOutputMode(true);

    expect(getCompactOutputMode()).toBe(true);
    await vi.waitFor(async () => {
      const settings = JSON.parse(await readFile(path.join(tempHome, "settings.json"), "utf-8"));
      expect(settings.compactOutputMode).toBe(true);
    });

    setCompactOutputMode(false);

    expect(getCompactOutputMode()).toBe(false);
    await vi.waitFor(async () => {
      const settings = JSON.parse(await readFile(path.join(tempHome, "settings.json"), "utf-8"));
      expect(settings.compactOutputMode).toBe(false);
    });
  });

  it("persists thinking content setting to settings.json", async () => {
    await loadSettings();

    setShowThinkingContent(false);

    expect(getShowThinkingContent()).toBe(false);
    await vi.waitFor(async () => {
      const settings = JSON.parse(await readFile(path.join(tempHome, "settings.json"), "utf-8"));
      expect(settings.showThinkingContent).toBe(false);
    });
  });

  it("persists diff file attachment setting to settings.json", async () => {
    await loadSettings();

    setSendDiffFileAttachments(false);

    expect(getSendDiffFileAttachments()).toBe(false);
    await vi.waitFor(async () => {
      const settings = JSON.parse(await readFile(path.join(tempHome, "settings.json"), "utf-8"));
      expect(settings.sendDiffFileAttachments).toBe(false);
    });
  });

  it("persists assistant run footer setting to settings.json", async () => {
    await loadSettings();

    setShowAssistantRunFooter(false);

    expect(getShowAssistantRunFooter()).toBe(false);
    await vi.waitFor(async () => {
      const settings = JSON.parse(await readFile(path.join(tempHome, "settings.json"), "utf-8"));
      expect(settings.showAssistantRunFooter).toBe(false);
    });
  });

  it("persists response streaming mode to settings.json", async () => {
    await loadSettings();

    setResponseStreamingMode("draft");

    expect(getResponseStreamingMode()).toBe("draft");
    await vi.waitFor(async () => {
      const settings = JSON.parse(await readFile(path.join(tempHome, "settings.json"), "utf-8"));
      expect(settings.responseStreamingMode).toBe("draft");
    });
  });
});
