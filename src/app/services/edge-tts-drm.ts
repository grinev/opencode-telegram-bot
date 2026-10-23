/**
 * Microsoft Edge TTS "Sec-MS-GEC" DRM token, v2 generation.
 *
 * Microsoft's Read Aloud service requires a `Sec-MS-GEC` token on every
 * WebSocket upgrade. The v1 token was plain `SHA256(<ticks><TRUSTED_CLIENT_TOKEN>)`;
 * the service now rejects it with HTTP 403 and expects a v2 token of the shape
 * `<16 hex>-<64 hex>` — a CS64 digest (custom keyed hash over the same input,
 * keyed with words derived from a modified SHA-256) joined to a modified
 * SHA-256 digest by a dash, plus `Sec-MS-GEC-Version=2-<Chromium version>`.
 *
 * Ported from the Python reference implementation:
 * https://github.com/rany2/edge-tts/blob/master/src/edge_tts/drm.py
 *
 * The reference implementation is written for arbitrary-precision integers and
 * masks every intermediate sum; this port keeps the same semantics on 32-bit
 * lanes. Multiplications are done with `Math.imul` (the low 32 bits of the
 * product) and shifts/XORs are masked with `>>> 0`, so every value stays in
 * `[0, 2**32)` exactly like the Python `& 0xFFFFFFFF`.
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH_SECONDS = 11_644_473_600;
const ROUND_SECONDS = 300;
const TICKS_PER_UNIX_SECOND = 1e7;

/** Rotate a 32-bit value left by 16 bits. */
function rol16(value: number): number {
  return (((value << 16) | (value >>> 16)) >>> 0) as number;
}

/** Rotate a 32-bit value right by `n` bits. */
function rotr(value: number, n: number): number {
  return ((value >>> n) | (value << (32 - n))) >>> 0;
}

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Standard constant with index 14 replaced, as the reference does. */
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_CONSTANTS = [
  ...SHA256_ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...SHA256_ROUND_CONSTANTS.slice(15),
];
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060, 0x72766564,
];

const CS64_COEFFICIENTS: ReadonlyArray<readonly [number, number]> = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

/** SHA-256 small sigma zero, combining rotations under one mask. */
function sigma0(value: number): number {
  return ((value >>> 7) ^ (value << 25) ^ (value >>> 18) ^ (value << 14) ^ (value >>> 3)) >>> 0;
}

/** SHA-256 small sigma one, combining rotations under one mask. */
function sigma1(value: number): number {
  return ((value >>> 17) ^ (value << 15) ^ (value >>> 19) ^ (value << 13) ^ (value >>> 10)) >>> 0;
}

/**
 * SHA-256 rounds. `firstRound` resumes mid-block: the reference precomputes the
 * first fourteen rounds into the initial state and continues from round 14.
 */
function sha256Rounds(
  state: readonly number[],
  words: readonly number[],
  firstRound = 0,
): number[] {
  const [s0, s1, s2, s3, s4, s5, s6, s7] = state;
  let a = s0!;
  let b = s1!;
  let c = s2!;
  let d = s3!;
  let e = s4!;
  let f = s5!;
  let g = s6!;
  let h = s7!;
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let index = firstRound; index < 64; index++) {
    const t1 =
      (h +
        ((rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0) +
        ((g ^ (e & (f ^ g))) >>> 0) +
        constants[index]! +
        words[index]!) >>>
      0;
    const t2 =
      (((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0) + (((a & b) | (c & (a | b))) >>> 0)) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

/** SHA-256 message schedule expansion. */
function expandSchedule(words: number[], firstWord = 16): void {
  for (let index = firstWord; index < 64; index++) {
    words.push(
      (sigma1(words[index - 2]!) +
        words[index - 7]! +
        sigma0(words[index - 15]!) +
        words[index - 16]!) >>>
        0,
    );
  }
}

/** Builds the modified SHA-256 initial state the reference derives from the 7-byte salt. */
function sha256Init(data: Buffer): number[] {
  const words: number[] = new Array<number>(14).fill(0);
  words.push(((data[0]! << 16) | (data[1]! << 8) | data[2]!) >>> 0);
  words.push(((data[3]! << 24) | (data[4]! << 16) | (data[5]! << 8) | data[6]!) >>> 0);
  for (let index = 16; index < 30; index++) {
    let value = SHA256_SCHEDULE[index - 16]! >>> 0;
    if (index - 2 >= 14) {
      const sigma = sigma1(words[index - 2]!);
      value = (value + (index === 16 ? (sigma ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0 : sigma)) >>> 0;
    }
    if (index - 7 >= 14) {
      value = (value + words[index - 7]!) >>> 0;
    }
    if (index - 15 >= 14) {
      const sigma = sigma0(words[index - 15]!);
      value = (value + (index === 29 ? (sigma ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0 : sigma)) >>> 0;
    }
    words.push(value);
  }
  words.push(
    (sigma1(words[28]!) +
      words[23]! +
      sigma0(words[15]!) +
      words[14]! +
      SHA256_ADJUSTMENT -
      SHA256_ROUND_CONSTANTS[14]!) >>>
      0,
  );
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return working.map((value, index) => (value + SHA256_INITIAL[index]!) >>> 0);
}

/** Modified SHA-256 digest: the first seven bytes seed the state, not the block. */
function sha256Digest(data: Buffer): Buffer {
  const length = 57 + data.length;
  const padding = (((55 - length) % 64) + 64) % 64;
  const padded = Buffer.concat([
    data.subarray(7),
    Buffer.from([0x80]),
    Buffer.alloc(padding),
    Buffer.alloc(8),
  ]);
  padded.writeBigUInt64BE(BigInt(length) * 8n, padded.length - 8);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let word = 0; word < 16; word++) {
      words.push(padded.readUInt32BE(offset + word * 4));
    }
    expandSchedule(words, 16);
    const working = sha256Rounds(state, words, 0);
    state = state.map((value, index) => (value + working[index]!) >>> 0);
  }

  const digest = Buffer.alloc(32);
  state.forEach((value, index) => digest.writeUInt32BE(value, index * 4));
  return digest;
}

/** Splits data into little-endian 32-bit words, zero-padded to an even count. */
function wordsLe4Even(data: Buffer): number[] {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const words: number[] = [];
  for (let offset = 0; offset < padded.length; offset += 4) {
    words.push(padded.readUInt32LE(offset));
  }
  if (words.length % 2) {
    words.push(0);
  }
  return words;
}

/** CS64 digest: the custom keyed hash half of the v2 token. */
function cs64Digest(data: Buffer, digest: Buffer): [number, number] {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const factors = [Math.imul(keyA, CS64_FACTOR) >>> 0, Math.imul(keyB, CS64_FACTOR) >>> 0];

  const terms: number[] = [];
  const offsets: number[] = [];
  CS64_COEFFICIENTS.forEach(([coefficient, offset], index) => {
    terms.push(Math.imul(coefficient, factors[index % 2]!) >>> 0);
    offsets.push(offset >>> 0);
  });

  wordsLe4Even(Buffer.concat([Buffer.from([0]), data])).forEach((word, index) => {
    let term = Math.imul(word, index % 2 === 0 ? keyA : keyB) >>> 0;
    let offset = Math.imul(rol16(word), index % 2 === 0 ? 0xef0569fb : 0xc31713db) >>> 0;
    if (index === 0) {
      term = (term + (Math.imul(CS64_ADJUSTMENT0, factors[0]!) >>> 0)) >>> 0;
      offset = (offset + CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index]!;
    const y = terms[index + 1]!;

    let rotated = rol16((offsets[index]! + x) >>> 0);
    let q = Math.imul(rotated, 0x76f50f34) >>> 0;
    swapAcc = (swapAcc + (Math.imul(rol16(q), 0xc3efea97) >>> 0) + q) >>> 0;

    rotated = rol16((offsets[index + 1]! + y) >>> 0);
    q = Math.imul(rotated, 0x1881ce3c) >>> 0;
    swapLast = (Math.imul(rol16(q), 0x35bd1ec9) >>> 0) + q;
    swapLast = swapLast >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (Math.imul(state, keyA) + x) >>> 0;
    state = Math.imul(rol16(state), 0xcf98b111) >>> 0;
    state = Math.imul(rol16(state), 0x87085b9f) >>> 0;
    state = Math.imul(rol16(state), 0x12ceb96d) >>> 0;
    state = Math.imul(rol16(state), 0x257e1d83) >>> 0;
    acc = (acc + state) >>> 0;

    rotated = (Math.imul(state, keyB) + y) >>> 0;
    rotated = Math.imul(rol16(rotated), 0xa27416f5) >>> 0;
    rotated = Math.imul(rol16(rotated), 0xd38396ff) >>> 0;
    state = Math.imul(rol16(Math.imul(rol16(rotated), 0x7c932b89) >>> 0), 0xbfa49f69) >>> 0;
    acc = (acc + state) >>> 0;
  }

  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

/** Joins the CS64 and modified-SHA-256 digests as `<16 hex>-<64 hex>`. */
function tokenHash(data: Buffer): string {
  const digest = sha256Digest(data);
  const cs64 = Buffer.alloc(8);
  const [first, second] = cs64Digest(data, digest);
  cs64.writeUInt32LE(first, 0);
  cs64.writeUInt32LE(second, 4);
  return `${cs64.toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}

/**
 * Generates a v2 `Sec-MS-GEC` token for the given Unix timestamp (seconds).
 *
 * The timestamp is shifted to the Windows file-time epoch and rounded down to
 * the nearest five minutes, matching the reference implementation; the service
 * accepts any token valid within the current window.
 */
export function generateSecMsGecV2(unixTimestampSeconds: number): string {
  let ticks = unixTimestampSeconds + WIN_EPOCH_SECONDS;
  ticks -= ticks % ROUND_SECONDS;
  const strToHash = Buffer.from(
    `${Math.round(ticks * TICKS_PER_UNIX_SECOND)}${TRUSTED_CLIENT_TOKEN}`,
    "ascii",
  );
  return tokenHash(strToHash);
}
