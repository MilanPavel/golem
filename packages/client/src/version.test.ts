import assert from "node:assert/strict";
import { test } from "node:test";

import { GOLEM_VERSION } from "./index.ts";

test("a checkout has no stamped version", () => {
  assert.equal(GOLEM_VERSION, "0.0.0-dev");
});
