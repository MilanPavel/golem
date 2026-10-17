import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { formatCliVersion } from "./format-version.ts";
import { CLI_VERSION } from "./version.ts";

test("the CLI version is read from its package.json", () => {
  const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  assert.equal(CLI_VERSION, parsed.version);
});

test("golem --version prints the CLI version, and the daemon version when it answered", () => {
  assert.equal(formatCliVersion("0.0.0", null), "golem 0.0.0");
  assert.equal(formatCliVersion("0.0.0", ""), "golem 0.0.0");
  assert.equal(formatCliVersion("0.0.0", "0.0.0"), "golem 0.0.0\ndaemon 0.0.0");
  assert.equal(formatCliVersion("0.0.0", "0.1.0"), "golem 0.0.0\ndaemon 0.1.0");
});
