import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { resolveSocketPath } from "./socket-path.ts";

const original = process.env["GOLEM_HOME"];

afterEach(() => {
  if (original === undefined) {
    delete process.env["GOLEM_HOME"];
  } else {
    process.env["GOLEM_HOME"] = original;
  }
});

test("explicit home wins over the environment", () => {
  process.env["GOLEM_HOME"] = "/from-env";
  assert.equal(resolveSocketPath("/explicit"), path.resolve("/explicit/run/golem.sock"));
});

test("GOLEM_HOME is used when no home is passed", () => {
  process.env["GOLEM_HOME"] = "/from-env";
  assert.equal(resolveSocketPath(), path.resolve("/from-env/run/golem.sock"));
});

test("blank GOLEM_HOME falls through to ~/.golem", () => {
  process.env["GOLEM_HOME"] = "  ";
  assert.equal(
    resolveSocketPath(),
    path.join(os.homedir(), ".golem", "run", "golem.sock"),
  );
});

test("tilde is expanded", () => {
  delete process.env["GOLEM_HOME"];
  assert.equal(
    resolveSocketPath("~/golem-explicit"),
    path.join(os.homedir(), "golem-explicit", "run", "golem.sock"),
  );
});
