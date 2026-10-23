import { describe, expect, it } from "vitest";

import { generateSecMsGecV2 } from "../../../src/app/services/edge-tts-drm.js";

/**
 * Vectors produced by the Python reference implementation:
 * `edge_tts.drm.generate_sec_ms_gec_v2(<unix timestamp>)`, edge-tts 7.3.1.
 * They pin the modified SHA-256, the CS64 keyed hash and the Windows file-time
 * rounding, so a regression in any of them fails here first.
 */
const REFERENCE_VECTORS: ReadonlyArray<readonly [number, string]> = [
  [0, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
  [1704067200, "9586E5FBB4BD2CFF-DE636BA8369C7431ED826BDEEB00ECA1CC52826A6BB736DCB150A2AF37DFC498"],
  [1717243357, "9F3B2BBA43072A65-18E5C3DD3B530033102E8218C71223A2652AF710055462D4D169F51E3D0DFC6B"],
  [1717243499, "9F3B2BBA43072A65-18E5C3DD3B530033102E8218C71223A2652AF710055462D4D169F51E3D0DFC6B"],
  [1717243500, "34F2A57AEE7BC0B5-99CF975156B5F4EB74B4FEBB5F81D5F9DD3771C0F241237FF948C243634A2324"],
  [1761196800, "C9726F91BE3405F5-6D17FAF8C92E338F68EBFBAA0AC39F259811EA871E72452E3CA83E9A8E0C32E9"],
  [
    1761196999.99,
    "C9726F91BE3405F5-6D17FAF8C92E338F68EBFBAA0AC39F259811EA871E72452E3CA83E9A8E0C32E9",
  ],
  [1761197100, "B3FB9133679FD2D3-70F03932790E8A98D1978575BB50358CD6B4506CE6ECA73116CD3D2682CA2B3F"],
  [2000000000, "2D62557F1142BC5D-FD9C30C68FF194A5EE6B45FEFC5E2BA1D1239F88A90569AB55CFFFAA7799F40E"],
];

describe("generateSecMsGecV2", () => {
  it.each(REFERENCE_VECTORS)("matches the Python reference for %s", (timestamp, expected) => {
    expect(generateSecMsGecV2(timestamp)).toBe(expected);
  });

  it("returns a 16-hex CS64 joined to a 64-hex SHA-256 by a dash", () => {
    expect(generateSecMsGecV2(1704067200)).toMatch(/^[0-9A-F]{16}-[0-9A-F]{64}$/);
  });

  it("is stable inside a five-minute window and changes on the boundary", () => {
    expect(generateSecMsGecV2(1717243357)).toBe(generateSecMsGecV2(1717243499));
    expect(generateSecMsGecV2(1717243499)).not.toBe(generateSecMsGecV2(1717243500));
  });

  it("covers sub-second timestamps before the rounding step", () => {
    expect(generateSecMsGecV2(1717243357.42)).toBe(generateSecMsGecV2(1717243357));
  });
});
