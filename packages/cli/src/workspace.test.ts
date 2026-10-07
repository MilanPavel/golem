import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { findWorkspaceRoot } from "./workspace.ts";

test("findWorkspaceRoot walks up to the uv workspace", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  assert.equal(findWorkspaceRoot(here), path.resolve(here, "../../.."));
});
