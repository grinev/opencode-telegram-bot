import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockConfig = vi.hoisted(() => ({
  files: {
    maxFileSizeKb: 100,
    inboxDir: "",
    inboxRetentionDays: 7,
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    ...mockConfig,
    telegram: { token: "test", allowedUserId: 0, proxyUrl: "" },
    opencode: {
      serverVersion: "v1",
      apiUrl: "http://localhost:4096",
      username: "opencode",
      password: "",
      model: { provider: "test", modelId: "test" },
    },
    server: { logLevel: "error" },
    bot: {
      sessionsListLimit: 10,
      projectsListLimit: 10,
      locale: "en",
    },
  },
}));

import {
  buildLocalFileSection,
  pruneInbox,
  resolveInboxDir,
  sanitizeInboxFilename,
  saveTelegramFile,
} from "../../../src/app/services/file-inbox-service.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "file-inbox-"));
  tempDirs.push(dir);
  return dir;
}

const isWindows = process.platform === "win32";

describe("sanitizeInboxFilename", () => {
  it("keeps a plain filename unchanged", () => {
    expect(sanitizeInboxFilename("report.xlsx")).toBe("report.xlsx");
  });

  it("strips directory components", () => {
    expect(sanitizeInboxFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeInboxFilename("C:\\Users\\me\\archive.zip")).toBe("archive.zip");
  });

  it("replaces characters that are unsafe on Windows", () => {
    expect(sanitizeInboxFilename('re:port"<>|?*.zip')).toBe("re_port______.zip");
  });

  it("drops leading dots and trailing dots/spaces", () => {
    expect(sanitizeInboxFilename("...hidden.sqlite")).toBe("hidden.sqlite");
    expect(sanitizeInboxFilename("name. ")).toBe("name");
  });

  it("falls back to a generic name when nothing is left", () => {
    expect(sanitizeInboxFilename("")).toBe("file");
    expect(sanitizeInboxFilename("...")).toBe("file");
  });

  it("truncates long names but keeps the extension", () => {
    const longName = `${"a".repeat(300)}.zip`;
    const sanitized = sanitizeInboxFilename(longName);

    expect(sanitized.length).toBeLessThanOrEqual(120);
    expect(sanitized.endsWith(".zip")).toBe(true);
  });

  it("limits non-ASCII names by bytes so Linux filesystems accept them", () => {
    const sanitized = sanitizeInboxFilename(`${"漢".repeat(117)}.zip`);

    expect(Buffer.byteLength(sanitized, "utf8")).toBeLessThanOrEqual(200);
    expect(sanitized.endsWith(".zip")).toBe(true);
  });

  it("prefixes Windows device names that cannot be created as files", () => {
    expect(sanitizeInboxFilename("CON")).toBe("_CON");
    expect(sanitizeInboxFilename("nul.txt")).toBe("_nul.txt");
    expect(sanitizeInboxFilename("com1.tar.gz")).toBe("_com1.tar.gz");
    expect(sanitizeInboxFilename("console.zip")).toBe("console.zip");
  });
});

describe("resolveInboxDir", () => {
  afterEach(() => {
    mockConfig.files.inboxDir = "";
  });

  it("defaults to the inbox directory inside the bot home", () => {
    expect(path.basename(resolveInboxDir())).toBe("inbox");
  });

  it("resolves a configured directory to an absolute path", () => {
    mockConfig.files.inboxDir = "relative/inbox";

    expect(path.isAbsolute(resolveInboxDir())).toBe(true);
    expect(resolveInboxDir().endsWith(path.join("relative", "inbox"))).toBe(true);
  });
});

describe("saveTelegramFile", () => {
  it("writes the original bytes into a per-upload directory", async () => {
    const inboxDir = await createTempDir();
    const buffer = Buffer.from("sqlite bytes");

    const stored = await saveTelegramFile(buffer, "database.sqlite", inboxDir);

    expect(path.isAbsolute(stored.filePath)).toBe(true);
    expect(stored.filename).toBe("database.sqlite");
    expect(stored.filePath.startsWith(inboxDir)).toBe(true);
    expect(await readFile(stored.filePath)).toEqual(buffer);
  });

  it("does not overwrite an earlier upload with the same name", async () => {
    const inboxDir = await createTempDir();

    const first = await saveTelegramFile(Buffer.from("first"), "archive.zip", inboxDir);
    const second = await saveTelegramFile(Buffer.from("second"), "archive.zip", inboxDir);

    expect(first.filePath).not.toBe(second.filePath);
    expect(await readFile(first.filePath)).toEqual(Buffer.from("first"));
    expect(await readFile(second.filePath)).toEqual(Buffer.from("second"));
  });

  it("stores files with a private filename and a sanitized name", async () => {
    const inboxDir = await createTempDir();

    const stored = await saveTelegramFile(Buffer.from("data"), "../evil.zip", inboxDir);

    expect(stored.filename).toBe("evil.zip");
    if (!isWindows) {
      const fileMode = (await stat(stored.filePath)).mode & 0o777;
      const dirMode = (await stat(path.dirname(stored.filePath))).mode & 0o777;
      expect(fileMode).toBe(0o600);
      expect(dirMode).toBe(0o700);
    }
  });
});

describe("pruneInbox", () => {
  beforeEach(() => {
    mockConfig.files.inboxRetentionDays = 7;
  });

  afterEach(() => {
    mockConfig.files.inboxRetentionDays = 7;
  });

  it("returns zero when the inbox does not exist yet", async () => {
    const inboxDir = path.join(os.tmpdir(), `missing-inbox-${Date.now()}`);

    await expect(pruneInbox(inboxDir)).resolves.toBe(0);
  });

  it("removes uploads older than the retention window and keeps fresh ones", async () => {
    const inboxDir = await createTempDir();
    const oldDir = path.join(inboxDir, "1700000000000-abcdef12");
    const freshDir = path.join(inboxDir, "1700000000000-12345678");
    await mkdir(oldDir);
    await mkdir(freshDir);
    await writeFile(path.join(oldDir, "old.zip"), "old");
    await writeFile(path.join(freshDir, "fresh.zip"), "fresh");

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(oldDir, tenDaysAgo, tenDaysAgo);
    await utimes(freshDir, new Date(), new Date());

    const removed = await pruneInbox(inboxDir);

    expect(removed).toBe(1);
    expect(await readdir(inboxDir)).toEqual(["1700000000000-12345678"]);
  });

  it("leaves entries the bot did not create alone in a shared inbox", async () => {
    const inboxDir = await createTempDir();
    const unrelatedDir = path.join(inboxDir, "someone-elses-data");
    const unrelatedFile = path.join(inboxDir, "notes.txt");
    await mkdir(unrelatedDir);
    await writeFile(path.join(unrelatedDir, "keep.bin"), "keep");
    await writeFile(unrelatedFile, "keep");

    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(unrelatedDir, tenDaysAgo, tenDaysAgo);
    await utimes(unrelatedFile, tenDaysAgo, tenDaysAgo);

    const removed = await pruneInbox(inboxDir);

    expect(removed).toBe(0);
    expect((await readdir(inboxDir)).sort()).toEqual(["notes.txt", "someone-elses-data"]);
  });

  it("keeps files when retention is disabled", async () => {
    mockConfig.files.inboxRetentionDays = 0;
    const inboxDir = await createTempDir();
    const oldDir = path.join(inboxDir, "1700000000000-fedcba98");
    await mkdir(oldDir);
    await writeFile(path.join(oldDir, "old.zip"), "old");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await utimes(oldDir, tenDaysAgo, tenDaysAgo);

    await expect(pruneInbox(inboxDir)).resolves.toBe(0);
    expect(await readdir(inboxDir)).toEqual(["1700000000000-fedcba98"]);
  });
});

describe("buildLocalFileSection", () => {
  it("hands over the absolute path without implying a native attachment", () => {
    const section = buildLocalFileSection({
      filePath: "/home/user/inbox/1/archive.zip",
      filename: "archive.zip",
    });

    expect(section).toContain("/home/user/inbox/1/archive.zip");
    expect(section).toContain("archive.zip");
    expect(section).toContain("not a model attachment");
  });
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
