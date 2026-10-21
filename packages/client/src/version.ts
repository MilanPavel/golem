declare const GOLEM_VERSION: string | undefined;

/**
 * One version for the CLI and the TUI.
 * `bun build --define GOLEM_VERSION='"…"'` inlines the git tag. A checkout has no define.
 */
export const VERSION: string =
  typeof GOLEM_VERSION === "string" && GOLEM_VERSION.length > 0 ? GOLEM_VERSION : "0.0.0-dev";
