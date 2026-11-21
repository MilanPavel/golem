// A QR code encoder for the pairing link (ADR-051): byte mode, error correction level M, versions
// 1 to 15 (up to 412 bytes), and the smallest version that holds the text. It follows ISO/IEC 18004.
// It is written here because the pairing link is the only thing golem ever encodes, and the repository
// takes no package for it. The renderers are for a terminal (half-block characters) and for the web
// (an SVG path).

/** A finished symbol. `modules[row][column]` is true for a dark module. */
export interface QrCode {
  version: number;
  /** Modules per side: 17 + 4 * version. */
  size: number;
  /** The mask (0 to 7) with the lowest penalty. */
  mask: number;
  modules: readonly (readonly boolean[])[];
}

export const MIN_VERSION = 1;
export const MAX_VERSION = 15;

// ---- tables (ISO/IEC 18004, Tables 7 and 9, level M) --------------------------------------------

/** Error correction codewords in each block, by version (index 0 is unused). */
const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
/** The number of blocks, by version. */
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
/** Alignment pattern centres by version. */
const ALIGNMENT: readonly (readonly number[])[] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
];

/** The two format bits of level M. */
const LEVEL_M_BITS = 0b00;

// ---- Reed-Solomon over GF(256), x^8 + x^4 + x^3 + x^2 + 1 ------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0;
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : (EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0);
}

/** The generator polynomial of `degree` check codewords, highest power first, without the leading 1. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ (poly[j] ?? 0);
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j] ?? 0, EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly.slice(1);
}

/** The `degree` Reed-Solomon check codewords of `data`. */
export function reedSolomon(data: readonly number[], degree: number): number[] {
  const gen = generator(degree);
  const rest = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (rest.shift() ?? 0);
    rest.push(0);
    for (let i = 0; i < degree; i++) rest[i] = (rest[i] ?? 0) ^ gfMul(gen[i] ?? 0, factor);
  }
  return rest;
}

// ---- sizes ---------------------------------------------------------------------------------------------

/** Modules in a symbol that carry data and check bits (all but the function patterns). */
export function dataModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    n -= (25 * count - 10) * count - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

/** Codewords in a symbol of `version`, data and check together. */
export function totalCodewords(version: number): number {
  return Math.floor(dataModules(version) / 8);
}

/** Data codewords in a symbol of `version` at level M. */
export function dataCodewords(version: number): number {
  return totalCodewords(version) - (EC_PER_BLOCK[version] ?? 0) * (BLOCKS[version] ?? 0);
}

/** How many bytes of text a symbol of `version` holds at level M. */
export function byteCapacity(version: number): number {
  const countBits = version < 10 ? 8 : 16;
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits) / 8);
}

// ---- bits ------------------------------------------------------------------------------------------------

/** `value` as `length` bits, most significant first. */
function bits(value: number, length: number): number[] {
  const out: number[] = [];
  for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
  return out;
}

/** The remainder of `value` divided by `poly` over GF(2), for the BCH codes of the format and version fields. */
function bch(value: number, poly: number, polyBits: number): number {
  let rem = value << (polyBits - 1);
  for (let i = 31 - Math.clz32(rem); i >= polyBits - 1; i--) {
    if ((rem >>> i) & 1) rem ^= poly << (i - (polyBits - 1));
  }
  return rem;
}

/** The 15 format bits for level M and `mask`: BCH(15,5) of the five data bits, then XOR 101010000010010. */
export function formatBits(mask: number): number {
  const data = (LEVEL_M_BITS << 3) | mask;
  return ((data << 10) | bch(data, 0x537, 11)) ^ 0x5412;
}

/** The 18 version bits (version 7 and up): the six version bits and BCH(18,6). */
export function versionBits(version: number): number {
  return (version << 12) | bch(version, 0x1f25, 13);
}

// ---- the data codewords ------------------------------------------------------------------------------

function encodeData(bytes: Uint8Array, version: number): number[] {
  const out: number[] = [...bits(0b0100, 4), ...bits(bytes.length, version < 10 ? 8 : 16)];
  for (const b of bytes) out.push(...bits(b, 8));
  const capacity = dataCodewords(version) * 8;
  out.push(...new Array<number>(Math.min(4, capacity - out.length)).fill(0)); // terminator
  while (out.length % 8 !== 0) out.push(0);
  const words: number[] = [];
  for (let i = 0; i < out.length; i += 8) words.push(parseInt(out.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; words.length < dataCodewords(version); pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

/** Split into blocks, add each block's check codewords, and interleave: data first, then checks. */
function interleave(data: number[], version: number): number[] {
  const blocks = BLOCKS[version] ?? 1;
  const ec = EC_PER_BLOCK[version] ?? 0;
  const total = totalCodewords(version);
  const shortBlocks = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks);
  const parts: { data: number[]; check: number[] }[] = [];
  let at = 0;
  for (let i = 0; i < blocks; i++) {
    const length = shortLength - ec + (i < shortBlocks ? 0 : 1);
    const part = data.slice(at, at + length);
    at += length;
    parts.push({ data: part, check: reedSolomon(part, ec) });
  }
  const out: number[] = [];
  const longest = Math.max(...parts.map((p) => p.data.length));
  for (let i = 0; i < longest; i++) for (const p of parts) if (i < p.data.length) out.push(p.data[i] ?? 0);
  for (let i = 0; i < ec; i++) for (const p of parts) out.push(p.check[i] ?? 0);
  return out;
}

// ---- the matrix ------------------------------------------------------------------------------------------

interface Grid {
  size: number;
  dark: boolean[][];
  /** True for a function module: not data, and not masked. */
  reserved: boolean[][];
}

function newGrid(size: number): Grid {
  const make = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, dark: make(), reserved: make() };
}

function setFunction(g: Grid, row: number, col: number, dark: boolean): void {
  if (row < 0 || col < 0 || row >= g.size || col >= g.size) return;
  (g.dark[row] as boolean[])[col] = dark;
  (g.reserved[row] as boolean[])[col] = true;
}

/** The finder pattern whose top left module is (`row`, `col`), with its separator. */
function finder(g: Grid, row: number, col: number): void {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
      setFunction(g, row + dr, col + dc, ring !== 2 && ring !== 4); // ring 4 is the separator
    }
  }
}

function alignment(g: Grid, row: number, col: number): void {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) setFunction(g, row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
}

/** Write the format bits in both places. Bit 14 is the most significant. */
function drawFormat(g: Grid, mask: number): void {
  const f = formatBits(mask);
  const bit = (i: number) => ((f >>> i) & 1) === 1;
  const n = g.size;
  // Around the top left finder.
  for (let i = 0; i <= 5; i++) setFunction(g, i, 8, bit(i));
  setFunction(g, 7, 8, bit(6));
  setFunction(g, 8, 8, bit(7));
  setFunction(g, 8, 7, bit(8));
  for (let i = 9; i < 15; i++) setFunction(g, 8, 14 - i, bit(i));
  // Under the top right finder and beside the bottom left finder.
  for (let i = 0; i < 8; i++) setFunction(g, 8, n - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) setFunction(g, n - 15 + i, 8, bit(i));
  setFunction(g, n - 8, 8, true); // the one fixed dark module
}

function drawVersion(g: Grid, version: number): void {
  if (version < 7) return;
  const v = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((v >>> i) & 1) === 1;
    const a = g.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(g, a, b, dark);
    setFunction(g, b, a, dark);
  }
}

function drawFunctions(version: number): Grid {
  const g = newGrid(17 + 4 * version);
  for (let i = 0; i < g.size; i++) {
    setFunction(g, 6, i, i % 2 === 0); // timing
    setFunction(g, i, 6, i % 2 === 0);
  }
  finder(g, 0, 0);
  finder(g, 0, g.size - 7);
  finder(g, g.size - 7, 0);
  const centres = ALIGNMENT[version] ?? [];
  const last = centres.length - 1;
  centres.forEach((r, i) => {
    centres.forEach((c, j) => {
      const onFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!onFinder) alignment(g, r, c);
    });
  });
  drawFormat(g, 0); // reserves the area; the real bits are written once the mask is chosen
  drawVersion(g, version);
  return g;
}

function placeData(g: Grid, codewords: number[]): void {
  let i = 0;
  const total = codewords.length * 8;
  for (let right = g.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern takes column 6
    for (let v = 0; v < g.size; v++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? g.size - 1 - v : v;
        if (!(g.reserved[row] as boolean[])[col] && i < total) {
          (g.dark[row] as boolean[])[col] = (((codewords[i >>> 3] ?? 0) >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

function maskTest(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function applyMask(g: Grid, mask: number): void {
  for (let r = 0; r < g.size; r++) {
    for (let c = 0; c < g.size; c++) {
      if (!(g.reserved[r] as boolean[])[c] && maskTest(mask, r, c)) (g.dark[r] as boolean[])[c] = !(g.dark[r] as boolean[])[c];
    }
  }
}

/** The penalty of ISO/IEC 18004 section 7.8.3: runs, 2x2 blocks, finder-like patterns, and dark balance. */
export function penalty(dark: readonly (readonly boolean[])[]): number {
  const n = dark.length;
  const at = (r: number, c: number) => dark[r]?.[c] === true;
  let score = 0;
  // Rule 1: five or more in a row or column, 3 + (run - 5).
  for (const horizontal of [true, false]) {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b <= n; b++) {
        const same = b < n && (horizontal ? at(a, b) === at(a, b - 1) : at(b, a) === at(b - 1, a));
        if (same) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
    }
  }
  // Rule 2: each 2x2 block of one colour, 3.
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
  }
  // Rule 3: 1:1:3:1:1 with four light modules on a side, 40 each.
  const a = [true, false, true, true, true, false, true, false, false, false, false];
  const b = [false, false, false, false, true, false, true, true, true, false, true];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c + 11 <= n; c++) {
      const row = (p: boolean[]) => p.every((v, k) => at(r, c + k) === v);
      const col = (p: boolean[]) => p.every((v, k) => at(c + k, r) === v);
      if (row(a)) score += 40;
      if (row(b)) score += 40;
      if (col(a)) score += 40;
      if (col(b)) score += 40;
    }
  }
  // Rule 4: 10 for each 5% the dark share is away from 50%.
  let count = 0;
  for (const row of dark) for (const v of row) if (v) count++;
  const percent = (count * 100) / (n * n);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

// ---- the encoder -------------------------------------------------------------------------------------------

function build(codewords: number[], version: number, mask: number): boolean[][] {
  const g = drawFunctions(version);
  placeData(g, codewords);
  applyMask(g, mask);
  drawFormat(g, mask);
  return g.dark;
}

function pickVersion(bytes: Uint8Array): number {
  let version = MIN_VERSION;
  while (version <= MAX_VERSION && byteCapacity(version) < bytes.length) version++;
  if (version > MAX_VERSION) throw new Error(`the text is ${bytes.length} bytes; a QR code here holds ${byteCapacity(MAX_VERSION)}`);
  return version;
}

/** Encode `text` (as UTF-8) at level M. Throws when it is longer than 412 bytes. */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes);
  const codewords = interleave(encodeData(bytes, version), version);
  let best: { mask: number; dark: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    const dark = build(codewords, version, mask);
    const score = penalty(dark);
    if (best === null || score < best.score) best = { mask, dark, score };
  }
  const chosen = best as { mask: number; dark: boolean[][] };
  return { version, size: 17 + 4 * version, mask: chosen.mask, modules: chosen.dark };
}

/** The symbol for one given mask, for tests that compare the penalty of all eight. */
export function encodeQrWithMask(text: string, mask: number): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes);
  const dark = build(interleave(encodeData(bytes, version), version), version, mask);
  return { version, size: 17 + 4 * version, mask, modules: dark };
}

// ---- renderers ----------------------------------------------------------------------------------------------

/** Quiet zone in modules. The standard asks for 4. */
export const QUIET = 4;

export interface TerminalOptions {
  /**
   * Draw with explicit black and white colours (the default), so the code reads the same on a dark and a
   * light terminal. Without colours the half blocks use the terminal's own, which scans only on a dark-on-light theme.
   */
  color?: boolean;
  quiet?: number;
}

/** Two rows of modules per line of text, with the half-block characters. */
export function qrToTerminal(qr: QrCode, options: TerminalOptions = {}): string {
  const color = options.color ?? true;
  const quiet = options.quiet ?? QUIET;
  const span = qr.size + 2 * quiet;
  const dark = (r: number, c: number) => qr.modules[r - quiet]?.[c - quiet] === true;
  const lines: string[] = [];
  for (let r = 0; r < span; r += 2) {
    let line = "";
    for (let c = 0; c < span; c++) {
      const top = dark(r, c);
      const bottom = dark(r + 1, c);
      if (color) line += `\u001b[38;5;${top ? 0 : 15}m\u001b[48;5;${bottom ? 0 : 15}m▀`;
      else line += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
    }
    lines.push(color ? `${line}\u001b[0m` : line);
  }
  return lines.join("\n");
}

/** One SVG path for every dark module, in module units (`viewBox` 0 0 size size, quiet zone included). */
export function qrToPath(qr: QrCode, quiet = QUIET): string {
  let d = "";
  qr.modules.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (row[c] !== true) {
        c++;
        continue;
      }
      let end = c;
      while (row[end] === true) end++;
      d += `M${c + quiet} ${r + quiet}h${end - c}v1h${c - end}z`;
      c = end;
    }
  });
  return d;
}

/** The side of the drawing in modules, quiet zone included. */
export function qrSpan(qr: QrCode, quiet = QUIET): number {
  return qr.size + 2 * quiet;
}
