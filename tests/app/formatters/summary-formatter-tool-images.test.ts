import { describe, expect, it } from "vitest";
import { prepareToolImages } from "../../../src/app/formatters/summary-formatter.js";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("app/formatters/summary-formatter prepareToolImages", () => {
  it("decodes a data-URL image into a photo payload", () => {
    const files = prepareToolImages({
      images: [
        {
          uri: `data:image/png;base64,${PNG_B64}`,
          mime: "image/png",
          name: "C:\\shots\\catbird-after.png",
        },
      ],
    });

    expect(files).toHaveLength(1);
    expect(files[0].image).toBe(true);
    expect(files[0].filename).toBe("catbird-after.png");
    expect(files[0].caption).toBe("catbird-after.png");
    expect(files[0].buffer.toString("base64")).toBe(PNG_B64);
  });

  it("names an unnamed image by its mime subtype", () => {
    const files = prepareToolImages({
      images: [{ uri: `data:image/jpeg;base64,${PNG_B64}`, mime: "image/jpeg" }],
    });

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("image.jpeg");
  });

  it("ignores metadata without images and malformed or empty entries", () => {
    expect(prepareToolImages(undefined)).toEqual([]);
    expect(prepareToolImages({})).toEqual([]);
    expect(
      prepareToolImages({
        images: [
          "not-a-record",
          { uri: "file:///tmp/x.png", mime: "image/png" },
          { uri: `data:image/png;base64,${PNG_B64}`, mime: "application/pdf" },
          { uri: "data:image/png;base64,", mime: "image/png" },
        ],
      }),
    ).toEqual([]);
  });
});
