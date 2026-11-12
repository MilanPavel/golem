// Draws the app icons from the pixel golem. Run with `just icons`; the PNGs are committed.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { FAVICON_COLORS } from "../src/features/tab-status/favicon-colors.ts";
import { ART, CELLS, WIDTH } from "../src/ui/pixel-golem.tsx";

export type Icon = { file: string; size: number; kind: "any" | "maskable" | "touch" };

export const ICONS: readonly Icon[] = [
  { file: "icon-192.png", size: 192, kind: "any" },
  { file: "icon-512.png", size: 512, kind: "any" },
  { file: "icon-maskable-512.png", size: 512, kind: "maskable" },
  { file: "apple-touch-icon.png", size: 180, kind: "touch" },
];

/** The light value of `--color-bg`, which tokens.css holds and a test keeps equal. */
export const BG = "#F3F2EF";

const FIGURE_SHARE = { any: 0.64, touch: 0.64, maskable: 0.5 } as const;

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** An 8-bit RGB PNG of the idle pixel golem on `--color-bg`: whole cells, no blur. */
export function renderIcon(size: number, kind: Icon["kind"]): Buffer {
  const cell = Math.floor((FIGURE_SHARE[kind] * size) / WIDTH);
  const left = Math.floor((size - WIDTH * cell) / 2);
  const top = Math.floor((size - ART.length * cell) / 2);
  const bg = rgb(BG);
  const body = rgb(FAVICON_COLORS["golem-body"][0]);
  const eye = rgb(FAVICON_COLORS["golem-eye"][0]);
  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor((x - left) / cell);
      const cy = Math.floor((y - top) / cell);
      const hit = x >= left && y >= top ? CELLS.find((c) => c.x === cx && c.y === cy) : undefined;
      raw.set(hit === undefined ? bg : hit.eye ? eye : body, y * rowLen + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { file, size, kind } of ICONS) {
    writeFileSync(new URL(`../public/${file}`, import.meta.url), renderIcon(size, kind));
  }
}
