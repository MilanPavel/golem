import packageJson from "../package.json" with { type: "json" };

/** The CLI build's own version. A bundle inlines this; it does not read the file later. */
export const CLI_VERSION: string = packageJson.version;
