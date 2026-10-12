/** Pixel mark. Two pixel rows share a cell; a split cell is `▀` with both colors. */

const ART = [
  ".......lbbs.......",
  ".....lbbbbbbs.....",
  ".....lbbddbbs.....",
  "....lbbbbbbbbs....",
  "....ldddbbddds....",
  "....lbddbbddbs....",
  "....lbbbbbbbbs....",
  "....lbbbbbbbbs....",
  "....lbbbbbbbbs....",
  "..lbbbbbbbbbbbbs..",
  ".lbbbbbbbbbbbbbbs.",
  "lbbbbbbbbbbbbbbbbs",
  "lbbbbbbbbbbbbbbbbs",
  ".ssssssssssssssss.",
] as const;

export type LogoTone = "highlight" | "body" | "shadow" | "eye";

type Pixel = LogoTone | null;

const TONE: Record<string, LogoTone> = {
  l: "highlight",
  b: "body",
  s: "shadow",
  d: "eye",
};

export type LogoRun = {
  text: string;
  color: LogoTone | null;
  background: LogoTone | null;
};

function paint(): Pixel[][] {
  return ART.map((row) => [...row].map((char) => TONE[char] ?? null));
}

export const logoPixels: readonly (readonly Pixel[])[] = paint();

type Cell = {
  glyph: string;
  color: LogoTone | null;
  background: LogoTone | null;
};

function cell(top: Pixel, bottom: Pixel): Cell {
  if (top === null && bottom === null) {
    return { glyph: " ", color: null, background: null };
  }
  if (top !== null && bottom === null) {
    return { glyph: "▀", color: top, background: null };
  }
  if (top === null && bottom !== null) {
    return { glyph: "▄", color: bottom, background: null };
  }
  if (top === bottom) {
    return { glyph: "█", color: top, background: null };
  }
  return { glyph: "▀", color: top, background: bottom };
}

function runs(grid: readonly (readonly Pixel[])[]): LogoRun[][] {
  const width = grid[0]?.length ?? 0;
  const lines: LogoRun[][] = [];
  for (let y = 0; y < grid.length; y += 2) {
    const line: LogoRun[] = [];
    for (let x = 0; x < width; x += 1) {
      const next = cell(grid[y]?.[x] ?? null, grid[y + 1]?.[x] ?? null);
      const last = line.at(-1);
      if (
        last !== undefined &&
        last.color === next.color &&
        last.background === next.background &&
        last.text[0] === next.glyph
      ) {
        last.text += next.glyph;
      } else {
        line.push({ text: next.glyph, color: next.color, background: next.background });
      }
    }
    lines.push(line);
  }
  return lines;
}

export const logoRows: readonly LogoRun[][] = runs(logoPixels);
export const LOGO_ROWS = logoRows.length;
export const LOGO_WIDTH = ART[0].length;
