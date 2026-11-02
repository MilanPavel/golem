/**
 * The tokens' colours as hex, [light, dark], keyed by token name without `--color-`. A test
 * checks each pair against src/styles/tokens.css.
 */
export const FAVICON_COLORS = {
  "golem-body": ["#9C6B3C", "#A8733F"],
  "golem-eye": ["#2A1408", "#0E0704"],
  clay: ["#C4783A", "#D08549"],
  wait: ["#8A600E", "#E2B655"],
  deny: ["#A8402F", "#E58474"],
  "line-strong": ["#C9C3BA", "#3B332C"],
  faint: ["#6C665F", "#8F877E"],
} as const satisfies Record<string, readonly [string, string]>;
