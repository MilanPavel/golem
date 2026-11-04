import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// In the compiled golem, a module that opens the screen when it is imported
// opens a second one, without the service control, before `golem` opens its
// own (bun gives every bundled module the binary's path).
test("importing the TUI module opens no screen: only a call to runTui does", () => {
  const source = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  const calls = source.split("\n").filter((line) => /\brunTui\(/.test(line) && !line.includes("function runTui("));
  assert.deepEqual(calls, []);
  assert.ok(!source.includes("import.meta.url"));
  assert.ok(!source.includes("process.argv"));
});
