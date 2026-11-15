import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  read: vi.fn(),
  list: vi.fn(),
  entries: vi.fn(),
  serverVersion: "v1",
  files: { outgoingDocumentMaxSizeMb: 1 },
}));
vi.mock("../../../src/config.js", () => ({ config: { files: mocked.files } }));
vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: { file: { read: mocked.read, list: mocked.list } },
  opencodeV2Client: { file: { entries: mocked.entries } },
  get opencodeServerVersion() {
    return mocked.serverVersion;
  },
}));
import {
  classifyAssistantDocuments,
  readAssistantDocument,
} from "../../../src/app/services/assistant-document-service.js";

describe("assistant-document-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.serverVersion = "v1";
    mocked.files.outgoingDocumentMaxSizeMb = 1;
  });

  it.each(["/remote/project", "C:\\remote\\project"])(
    "classifies V1 files, missing entries and directories in %s",
    async (directory) => {
      mocked.list.mockResolvedValue({
        data: [
          { path: "a.txt", type: "file" },
          { path: "src", type: "directory" },
        ],
      });
      expect(await classifyAssistantDocuments(directory, ["a.txt", "src", "missing"])).toEqual(
        new Map([
          ["a.txt", "file"],
          ["src", "directory"],
          ["missing", "missing"],
        ]),
      );
      expect(mocked.list).toHaveBeenCalledWith({ directory, path: "." });
    },
  );

  it.each([
    ["/remote/p", "/remote/p/dir"],
    ["C:\\remote\\p", "C:\\remote\\p\\dir"],
  ])("uses V2 typed entries with the server path style (%s)", async (directory, parent) => {
    mocked.serverVersion = "v2";
    mocked.entries.mockResolvedValue({ data: [{ path: `${parent}/a.txt`, type: "file" }] });
    expect((await classifyAssistantDocuments(directory, ["dir/a.txt"])).get("dir/a.txt")).toBe(
      "file",
    );
    expect(mocked.entries).toHaveBeenCalledWith({ path: parent });
    expect(mocked.list).not.toHaveBeenCalled();
  });

  it("does not misclassify a failed listing as a directory or missing file", async () => {
    mocked.list.mockRejectedValueOnce(new Error("offline"));
    expect((await classifyAssistantDocuments("/p", ["a"])).get("a")).toBeUndefined();
  });

  it("preserves V2/binary bytes and uses V1 trimmed text exactly as returned", async () => {
    const binary = Buffer.from([0, 255, 13, 10, 32]);
    mocked.read.mockResolvedValueOnce({
      data: { type: "binary", encoding: "base64", content: binary.toString("base64") },
    });
    expect(await readAssistantDocument("/p", "a.bin")).toEqual({ bytes: binary });
    mocked.read.mockResolvedValueOnce({ data: { type: "text", content: "trimmed text" } });
    expect(await readAssistantDocument("/p", "a.txt")).toEqual({
      bytes: Buffer.from("trimmed text"),
    });
  });

  it("distinguishes confirmed empty files from missing or ambiguous empty V1 results", async () => {
    mocked.read.mockResolvedValue({ data: { type: "text", content: "" } });
    expect(await readAssistantDocument("/p", "empty", "file")).toEqual({ bytes: Buffer.alloc(0) });
    expect(await readAssistantDocument("/p", "unknown")).toEqual({ reason: "unavailable" });
    mocked.read.mockClear();
    expect(await readAssistantDocument("/p", "missing", "missing")).toEqual({
      reason: "unavailable",
    });
    expect(mocked.read).not.toHaveBeenCalled();
  });

  it("accepts exact limit and rejects oversized binary/text files independently of code limits", async () => {
    const bytes = Buffer.alloc(1024 * 1024, 32);
    mocked.read.mockResolvedValueOnce({
      data: { type: "binary", encoding: "base64", content: bytes.toString("base64") },
    });
    const result = await readAssistantDocument("/p", "a");
    expect("bytes" in result && result.bytes.equals(bytes)).toBe(true);
    mocked.read.mockResolvedValueOnce({
      data: {
        type: "binary",
        encoding: "base64",
        content: Buffer.alloc(bytes.length + 1).toString("base64"),
      },
    });
    expect(await readAssistantDocument("/p", "a")).toEqual({ reason: "too_large" });
    mocked.read.mockResolvedValueOnce({
      data: { type: "text", content: "я".repeat(bytes.length) },
    });
    expect(await readAssistantDocument("/p", "a")).toEqual({ reason: "too_large" });
  });

  it.each(["413 Request Entity Too Large", "FILE_TOO_BIG", "size limit exceeded"])(
    "classifies server size failure %s",
    async (message) => {
      mocked.read.mockResolvedValueOnce({ error: new Error(message) });
      expect(await readAssistantDocument("/p", "a")).toEqual({ reason: "too_large" });
    },
  );
});
