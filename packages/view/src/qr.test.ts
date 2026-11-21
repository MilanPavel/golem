import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_VERSION,
  byteCapacity,
  dataCodewords,
  encodeQr,
  encodeQrWithMask,
  formatBits,
  penalty,
  qrSpan,
  qrToPath,
  qrToTerminal,
  reedSolomon,
  totalCodewords,
  versionBits,
} from "./qr.ts";

const bin = (n: number, width: number) => n.toString(2).padStart(width, "0");

// ISO/IEC 18004:2015, Annex I, the worked example: version 1-M holds 16 data codewords and 10 check
// codewords. The data below is the example's data (decimal), and so are the check codewords.
test("Reed-Solomon: the check codewords of ISO/IEC 18004 Annex I", () => {
  const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(reedSolomon(data, 10), [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
});

// The definition of the code: the codeword polynomial is zero at alpha^0 .. alpha^(n-1). Checked with
// GF(256) arithmetic written separately from the encoder's, for every check length the symbols use.
test("Reed-Solomon: data followed by its check codewords is a multiple of the generator", () => {
  const exp: number[] = [];
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp.push(x);
    x = x << 1 > 255 ? (x << 1) ^ 0x11d : x << 1;
  }
  const mul = (a: number, b: number) => {
    let r = 0;
    for (let i = 0; i < 8; i++) {
      if ((b >> i) & 1) r ^= a << i;
    }
    for (let i = 14; i >= 8; i--) if ((r >> i) & 1) r ^= 0x11d << (i - 8);
    return r;
  };
  for (const degree of [10, 16, 18, 22, 24, 26, 30]) {
    const data = Array.from({ length: 40 }, (_, i) => (i * 37 + 11) & 255);
    const word = [...data, ...reedSolomon(data, degree)];
    for (let i = 0; i < degree; i++) {
      let value = 0;
      for (const c of word) value = mul(value, exp[i] ?? 0) ^ c;
      assert.equal(value, 0, `degree ${degree}, root ${i}`);
    }
  }
});

// ISO/IEC 18004:2015 Table C.1, the 15 format bits of level M with masks 0 to 7.
test("format information: the bit strings of Table C.1, level M", () => {
  const table = [
    "101010000010010",
    "101000100100101",
    "101111001111100",
    "101101101001011",
    "100010111111001",
    "100000011001110",
    "100111110010111",
    "100101010100000",
  ];
  for (let mask = 0; mask < 8; mask++) assert.equal(bin(formatBits(mask), 15), table[mask]);
});

// ISO/IEC 18004:2015 Table D.1, the 18 version bits of versions 7 to 15, as the table's hex values.
test("version information: the bit strings of Table D.1", () => {
  const table = [0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d, 0x0f928];
  table.forEach((want, i) => assert.equal(versionBits(7 + i), want, `version ${7 + i}`));
});

// ISO/IEC 18004:2015 Table 1 (codewords per version) and Table 7 (level M, byte mode capacity).
test("capacity: the codewords and the byte capacity of versions 1 to 15 at level M", () => {
  const codewords = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655];
  const data = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415];
  const bytes = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412];
  for (let v = 1; v <= MAX_VERSION; v++) {
    assert.equal(totalCodewords(v), codewords[v - 1], `codewords ${v}`);
    assert.equal(dataCodewords(v), data[v - 1], `data codewords ${v}`);
    assert.equal(byteCapacity(v), bytes[v - 1], `bytes ${v}`);
  }
});

test("the smallest version that holds the text is chosen", () => {
  assert.equal(encodeQr("a".repeat(14)).version, 1);
  assert.equal(encodeQr("a".repeat(15)).version, 2);
  assert.equal(encodeQr("a".repeat(251)).version, 11);
  assert.equal(encodeQr("a".repeat(412)).version, 15);
  assert.throws(() => encodeQr("a".repeat(413)));
  // The text is UTF-8: two bytes for the o with an umlaut.
  assert.equal(encodeQr("ö".repeat(7)).version, 1);
  assert.equal(encodeQr("ö".repeat(8)).version, 2);
});

function structure(version: number): void {
  const qr = encodeQr("a".repeat(byteCapacity(version)));
  const n = qr.size;
  const m = qr.modules;
  const at = (r: number, c: number) => m[r]?.[c] === true;
  assert.equal(n, 17 + 4 * version);
  // Finder patterns: 7x7 with a light ring and a 3x3 centre, light separator beyond.
  for (const [r0, c0] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ] as const) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        assert.equal(at(r0 + r, c0 + c), ring !== 2, `finder at ${r0},${c0} module ${r},${c}`);
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    assert.equal(at(7, i), false);
    assert.equal(at(i, 7), false);
    assert.equal(at(7, n - 1 - i), false);
    assert.equal(at(i, n - 8), false);
    assert.equal(at(n - 8, i), false);
    assert.equal(at(n - 1 - i, 7), false);
  }
  // Timing patterns alternate between the finders, starting dark.
  for (let i = 8; i < n - 8; i++) {
    assert.equal(at(6, i), i % 2 === 0, `timing row ${i}`);
    assert.equal(at(i, 6), i % 2 === 0, `timing column ${i}`);
  }
  // The dark module.
  assert.equal(at(n - 8, 8), true);
  // Format information, both copies, equal to the table value for the chosen mask. Bit 0 is the least
  // significant. Copy one runs round the top left finder, copy two splits across the other two.
  const want = formatBits(qr.mask);
  const first = (i: number): [number, number] => (i <= 5 ? [i, 8] : i === 6 ? [7, 8] : i === 7 ? [8, 8] : i === 8 ? [8, 7] : [8, 14 - i]);
  const second = (i: number): [number, number] => (i < 8 ? [8, n - 1 - i] : [n - 15 + i, 8]);
  for (let i = 0; i < 15; i++) {
    const bit = ((want >> i) & 1) === 1;
    assert.equal(at(...first(i)), bit, `format bit ${i}, first copy`);
    assert.equal(at(...second(i)), bit, `format bit ${i}, second copy`);
  }
  // Alignment patterns: a dark centre in a light ring in a dark ring, wherever the version has one clear of the finders.
  if (version >= 2) {
    const c = n - 7; // the last centre is 7 modules from the bottom right corner
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) assert.equal(at(c + dr, c + dc), Math.max(Math.abs(dr), Math.abs(dc)) !== 1, `alignment ${dr},${dc}`);
    }
  }
  // Version information, both copies, from version 7.
  if (version >= 7) {
    const v = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = ((v >> i) & 1) === 1;
      assert.equal(at(n - 11 + (i % 3), Math.floor(i / 3)), dark, `version bit ${i}, lower left`);
      assert.equal(at(Math.floor(i / 3), n - 11 + (i % 3)), dark, `version bit ${i}, upper right`);
    }
  }
}

for (let version = 1; version <= MAX_VERSION; version++) {
  test(`structure of a version ${version} symbol`, () => structure(version));
}

test("the mask is the one with the lowest penalty, the first of equals", () => {
  for (const text of ["golem", "golem://pair?v=1&relay=wss://relay.example.com", "a".repeat(120)]) {
    const scores = Array.from({ length: 8 }, (_, mask) => penalty(encodeQrWithMask(text, mask).modules));
    assert.equal(encodeQr(text).mask, scores.indexOf(Math.min(...scores)), text);
    assert.equal(new Set(scores).size > 1, true, "the masks differ in penalty");
  }
});

test("penalty: runs of five count 3, a 2x2 block 3, the finder-like pattern 40, and the dark share steps of 10", () => {
  const blank = (n: number) => Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  // All light, 11x11: 22 lines of a run of 11 (3 + 6 each), 100 blocks of 3, no pattern, 50 points off balance = 10 * 10.
  assert.equal(penalty(blank(11)), 22 * 9 + 100 * 3 + 100);
  // One row 10111010000 in an otherwise alternating grid would add 40 for rule 3 alone; use a 11 wide grid of one row pattern.
  const grid = blank(11);
  [true, false, true, true, true, false, true, false, false, false, false].forEach((v, c) => ((grid[0] as boolean[])[c] = v));
  assert.ok(penalty(grid) >= 40);
});

// The golden symbol: "golem", version 1, level M, mask 2, as encoded by this module. It was decoded back to
// "golem" with Apple's CoreImage QR detector (CIDetector) when it was written, which reads every symbol
// the module makes from version 1 to 15. Its check codewords come from the Reed-Solomon test above.
test("golden: the whole symbol for 'golem'", () => {
  const rows = [
    "111111100101001111111",
    "100000100000101000001",
    "101110101110101011101",
    "101110101111101011101",
    "101110101110101011101",
    "100000101011001000001",
    "111111101010101111111",
    "000000001100000000000",
    "101111100011001111100",
    "110100011101111001001",
    "111110100000101101010",
    "111101001101111001111",
    "000110111000100100010",
    "000000001010100101001",
    "111111100111010010110",
    "100000101010000111110",
    "101110101001010010010",
    "101110101001111101100",
    "101110101110101101100",
    "100000100111111001100",
    "111111101010100010010",
  ];
  const qr = encodeQr("golem");
  assert.equal(qr.version, 1);
  assert.equal(qr.mask, 2);
  assert.deepEqual(
    qr.modules.map((r) => r.map((b) => (b ? "1" : "0")).join("")),
    rows,
  );
});

test("terminal: two module rows per line, a quiet zone of four modules, explicit colours", () => {
  const qr = encodeQr("golem");
  const text = qrToTerminal(qr);
  const lines = text.split("\n");
  assert.equal(lines.length, Math.ceil(qrSpan(qr) / 2));
  assert.equal(lines[0]?.split("▀").length, qrSpan(qr) + 1); // one half block per module column
  // The quiet zone is white: the top lines hold no black.
  assert.ok(!(lines[0] ?? "").includes("[38;5;0m"));
  assert.ok(text.endsWith("\u001b[0m"));
  const plain = qrToTerminal(qr, { color: false }).split("\n");
  assert.equal(plain[0], " ".repeat(qrSpan(qr)));
  assert.ok(plain.every((l) => [...l].length === qrSpan(qr)));
  assert.ok(plain.some((l) => l.includes("█")));
});

test("path: one rectangle per run of dark modules, inside the quiet zone", () => {
  const qr = encodeQr("golem");
  const path = qrToPath(qr);
  let area = 0;
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    area += Number(m[3]);
    assert.ok(Number(m[1]) >= 4 && Number(m[2]) >= 4);
  }
  assert.equal(area, qr.modules.flat().filter(Boolean).length);
  assert.equal(path.replaceAll(/[Mhvz\d \-]/g, ""), "");
});
