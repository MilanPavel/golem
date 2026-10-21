import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCliVersion } from "./format-version.ts";

test("golem --version prints the CLI version, and the daemon version when it answered", () => {
  assert.equal(formatCliVersion("0.0.0-dev", null), "golem 0.0.0-dev");
  assert.equal(formatCliVersion("0.0.0-dev", ""), "golem 0.0.0-dev");
  assert.equal(formatCliVersion("0.0.0-dev", "0.0.0-dev"), "golem 0.0.0-dev\ndaemon 0.0.0-dev");
  assert.equal(formatCliVersion("0.1.0", "0.1.0"), "golem 0.1.0\ndaemon 0.1.0");
});
