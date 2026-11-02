import { CELLS, ART, WIDTH } from "../../ui/pixel-golem.tsx";
import { FAVICON_COLORS } from "./favicon-colors.ts";
import type { GolemState } from "../../ui/golem-state.ts";

type ColorName = keyof typeof FAVICON_COLORS;

/** Body and eye colours per state, as in pixel-golem.css, without the animation. */
const PALETTE: Record<GolemState, { body: ColorName; eye: ColorName }> = {
  idle: { body: "golem-body", eye: "golem-eye" },
  thinking: { body: "golem-body", eye: "clay" },
  waiting: { body: "golem-body", eye: "wait" },
  failed: { body: "golem-body", eye: "deny" },
  offline: { body: "line-strong", eye: "faint" },
};

/** The figure as an SVG document, in the colours of a state. */
export function faviconSvg(state: GolemState): string {
  const { body, eye } = PALETTE[state];
  const [bodyLight, bodyDark] = FAVICON_COLORS[body];
  const [eyeLight, eyeDark] = FAVICON_COLORS[eye];
  const style =
    `.b{fill:${bodyLight}}.e{fill:${eyeLight}}` +
    `@media (prefers-color-scheme: dark){.b{fill:${bodyDark}}.e{fill:${eyeDark}}}`;
  const rects = CELLS.map(
    ({ x, y, eye: isEye }) => `<rect class="${isEye ? "e" : "b"}" x="${x}" y="${y}" width="1.02" height="1.02"/>`,
  ).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${ART.length}" shape-rendering="crispEdges">` +
    `<style>${style}</style>${rects}</svg>`
  );
}

/** The same figure as a data URL for a link's href. */
export function faviconHref(state: GolemState): string {
  return `data:image/svg+xml,${encodeURIComponent(faviconSvg(state))}`;
}
