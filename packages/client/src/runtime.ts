/** The programs the daemon can install for a server: Node (`npx`) and uv (`uvx`). Docker is never installed. */
export type RuntimeName = "node" | "uv";
