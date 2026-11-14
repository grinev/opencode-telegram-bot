import { beforeEach, describe, expect, it, vi } from "vitest";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../src/opencode/client.js", () => ({ opencodeClient: { file: { read } } }));
import {
  normalizeAssistantImagePath,
  readAssistantImage,
  TELEGRAM_PHOTO_MAX_BYTES,
} from "../../../src/app/services/assistant-image-service.js";

function png(): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(2, 16);
  bytes.writeUInt32BE(2, 20);
  return bytes;
}
function binary(bytes: Buffer) {
  return { data: { type: "binary", encoding: "base64", content: bytes.toString("base64") } };
}

describe("assistant-image-service", () => {
  beforeEach(() => read.mockReset());

  it.each([
    "../a.png",
    "%2e%2e/a.png",
    "/a.png",
    "\\\\host\\a.png",
    "C:\\a.png",
    "C:a.png",
    "https://a/x.png",
    "data:image/png;base64,aa",
    "file:a.png",
    "%252e%252e/a.png",
    "bad%xx",
    "a\u0000.png",
  ])("rejects unsafe paths without reading (%s)", async (source) => {
    expect(normalizeAssistantImagePath(source)).toBeUndefined();
    expect(await readAssistantImage("/project", source)).toEqual({ reason: "unavailable" });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["/remote/project", "C:\\remote\\project"])(
    "reads from the server project rather than the bot filesystem (%s)",
    async (directory) => {
      read.mockResolvedValue(binary(png()));
      const result = await readAssistantImage(directory, "./assets/a%20b.png");
      expect(result).toMatchObject({ bytes: png(), filename: "image.png" });
      expect(read).toHaveBeenCalledWith({ directory, path: "assets/a b.png" });
    },
  );

  it("maps server containment rejection, missing files and old V1 empty binaries to unavailable", async () => {
    for (const response of [
      { error: new Error("Path escapes the location") },
      { data: { type: "text", content: "" } },
      binary(Buffer.alloc(0)),
    ]) {
      read.mockResolvedValueOnce(response);
      expect(await readAssistantImage("/p", "link.png")).toEqual({ reason: "unavailable" });
    }
    read.mockRejectedValueOnce(new Error("offline"));
    expect(await readAssistantImage("/p", "a.png")).toEqual({ reason: "unavailable" });
  });

  it("rejects unsupported, oversized and excessive-dimension images independently of diff limits", async () => {
    read
      .mockResolvedValueOnce(binary(Buffer.from("GIF89a")))
      .mockResolvedValueOnce(binary(Buffer.alloc(TELEGRAM_PHOTO_MAX_BYTES + 1)));
    expect(await readAssistantImage("/p", "a.gif")).toEqual({ reason: "unsupported" });
    expect(await readAssistantImage("/p", "a.png")).toEqual({ reason: "too_large" });
    const bytes = png();
    bytes.writeUInt32BE(10000, 16);
    read.mockResolvedValueOnce(binary(bytes));
    expect(await readAssistantImage("/p", "a.png")).toEqual({ reason: "too_large" });
  });
});
