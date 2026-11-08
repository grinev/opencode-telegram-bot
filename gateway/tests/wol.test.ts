import assert from "node:assert/strict";
import test from "node:test";
import { createMagicPacket } from "../src/wol.js";

test("creates a valid 102-byte Wake-on-LAN magic packet", () => {
  const packet = createMagicPacket("aa:bb:cc:dd:ee:ff");

  assert.equal(packet.length, 102);
  assert.deepEqual([...packet.subarray(0, 6)], [255, 255, 255, 255, 255, 255]);
  assert.deepEqual([...packet.subarray(6, 12)], [170, 187, 204, 221, 238, 255]);
  assert.deepEqual([...packet.subarray(packet.length - 6)], [170, 187, 204, 221, 238, 255]);
});
