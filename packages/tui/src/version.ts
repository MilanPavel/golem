import packageJson from "../package.json" with { type: "json" };

/** The TUI build's own version. A bundle inlines this; it does not read the file later. */
export const TUI_VERSION: string = packageJson.version;
