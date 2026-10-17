import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TUI_VERSION } from "./version.ts";

test("the TUI version is read from its package.json", () => {
  const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  assert.equal(TUI_VERSION, parsed.version);
  assert.equal(TUI_VERSION.length > 0, true);
});
