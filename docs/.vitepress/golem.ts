// The pixel golem, from the one grid in packages/tui/src/logo.ts, so the TUI, the web UI,
// and the docs draw the same figure. Used by PixelGolem.vue, the favicon, and the sidebar marks.

import { logoPixels } from "../../packages/tui/src/logo.ts";
import type { Palette } from "./tokens.ts";

export interface Cell {
  x: number;
  y: number;
  eye: boolean;
}

export const GOLEM_WIDTH = logoPixels[0]?.length ?? 0;
export const GOLEM_HEIGHT = logoPixels.length;

/** Every filled pixel of the figure, row by row. */
export const GOLEM_CELLS: readonly Cell[] = logoPixels.flatMap((row, y) =>
  row.flatMap((tone, x) => (tone === null ? [] : [{ x, y, eye: tone === "eye" }])),
);

/** The figure as a standalone SVG, one rect per pixel, in two fixed colours. */
export function golemSvg(body: string, eye: string, style = ""): string {
  const rects = GOLEM_CELLS.map(
    ({ x, y, eye: isEye }) => `<rect x="${x}" y="${y}" width="1" height="1" class="${isEye ? "e" : "b"}"/>`,
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GOLEM_WIDTH} ${GOLEM_HEIGHT}" shape-rendering="crispEdges">` +
    `<style>.b{fill:${body}}.e{fill:${eye}}${style}</style>${rects}</svg>`
  );
}

const dataUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** The favicon: slip's colours, and kiln's when the system is dark. */
export function faviconHref(palette: Palette): string {
  const body = palette["golem-body"];
  const eye = palette["golem-eye"];
  if (!body || !eye) throw new Error("tokens.css has no --color-golem-body or --color-golem-eye");
  return dataUri(
    golemSvg(body.light, eye.light, `@media (prefers-color-scheme:dark){.b{fill:${body.dark}}.e{fill:${eye.dark}}}`),
  );
}

/** `--golem-mark`, the small golem beside each sidebar group, for slip and for kiln. */
export function markCss(palette: Palette): string {
  const mark = (side: "light" | "dark") => {
    const body = palette["golem-body"]?.[side];
    const eye = palette["golem-eye"]?.[side];
    if (!body || !eye) throw new Error("tokens.css has no --color-golem-body or --color-golem-eye");
    return `url("${dataUri(golemSvg(body, eye))}")`;
  };
  return `:root {\n  --golem-mark: ${mark("light")};\n}\n\nhtml.dark {\n  --golem-mark: ${mark("dark")};\n}\n`;
}
