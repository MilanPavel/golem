// Mermaid's "base" theme, coloured from golem's tokens. Mermaid works out shades from these
// colours, so it needs real values, not CSS variables, and one set per theme.

import type { Palette } from "../tokens.ts";

export function mermaidTheme(palette: Palette, dark: boolean) {
  const c = (name: string): string => {
    const token = palette[name];
    if (!token) throw new Error(`no --color-${name} in tokens.css`);
    return dark ? token.dark : token.light;
  };
  return {
    theme: "base" as const,
    darkMode: dark,
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
    themeVariables: {
      darkMode: dark,
      fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
      fontSize: "14px",
      background: c("bg"),
      // Boxes: clay-soft with a clay edge, the way golem's own things are marked.
      primaryColor: c("clay-soft"),
      primaryBorderColor: c("clay"),
      primaryTextColor: c("ink"),
      secondaryColor: c("surface"),
      secondaryBorderColor: c("line-strong"),
      secondaryTextColor: c("ink"),
      tertiaryColor: c("sunken"),
      tertiaryBorderColor: c("line"),
      tertiaryTextColor: c("muted"),
      mainBkg: c("clay-soft"),
      nodeBorder: c("clay"),
      nodeTextColor: c("ink"),
      lineColor: c("muted"),
      textColor: c("ink"),
      clusterBkg: c("sunken"),
      clusterBorder: c("line-strong"),
      titleColor: c("ink"),
      edgeLabelBackground: c("bg"),
      // Sequence diagrams.
      actorBkg: c("surface"),
      actorBorder: c("clay"),
      actorTextColor: c("ink"),
      actorLineColor: c("line-strong"),
      signalColor: c("muted"),
      signalTextColor: c("ink"),
      labelBoxBkgColor: c("surface"),
      labelBoxBorderColor: c("line-strong"),
      labelTextColor: c("ink"),
      loopTextColor: c("muted"),
      activationBkgColor: c("clay-soft"),
      activationBorderColor: c("clay"),
      sequenceNumberColor: c("on-clay"),
      // Notes read like the web UI's "waiting" state.
      noteBkgColor: c("wait-soft"),
      noteBorderColor: c("wait"),
      noteTextColor: c("ink"),
    },
  };
}
