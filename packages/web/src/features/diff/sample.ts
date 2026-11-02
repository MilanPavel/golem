/** Diffs for the gallery and the tests. */

export const SAMPLE_EDIT_DIFF = [
  "diff --git a/src/socket.ts b/src/socket.ts",
  "index 3f2a1c4..9b7d0e2 100644",
  "--- a/src/socket.ts",
  "+++ b/src/socket.ts",
  "@@ -1,6 +1,7 @@",
  ' import { WebSocket } from "ws";',
  '+import { clamp } from "./clamp";',
  " ",
  " export function connect(url: string) {",
  "-  const delay = Math.min(Math.max(attempt, 0), 8);",
  "+  const delay = clamp(attempt, 0, 8);",
  "   return new WebSocket(url);",
  " }",
  "@@ -20,5 +21,5 @@ export function retry() {",
  "   const wait = 250;",
  "-  const cap = 5000;",
  "-  const base = 2;",
  "+  const cap = 8000;",
  "   return wait * cap;",
  " }",
  "",
].join("\n");

export const SAMPLE_NEW_FILE_DIFF = [
  "diff --git a/src/clamp.ts b/src/clamp.ts",
  "new file mode 100644",
  "index 0000000..4c1d2aa",
  "--- /dev/null",
  "+++ b/src/clamp.ts",
  "@@ -0,0 +1,3 @@",
  "+export function clamp(n: number, lo: number, hi: number): number {",
  "+  return Math.min(Math.max(n, lo), hi);",
  "+}",
  "",
].join("\n");

export const SAMPLE_LONG_LINE_DIFF = [
  "--- a/docs/notes.md",
  "+++ b/docs/notes.md",
  "@@ -1,2 +1,2 @@",
  " # Notes",
  `-${"A line that does not wrap, so the block scrolls sideways. ".repeat(6)}`,
  `+${"A line that does not wrap, so the block scrolls sideways, now reworded. ".repeat(6)}`,
  "",
].join("\n");
