import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveMode, modeChanged, modeReport, nextMode } from "./permission-mode.ts";

test("the session's mode wins, then the default, then balanced", () => {
  assert.equal(effectiveMode("autopilot", "careful"), "autopilot");
  assert.equal(effectiveMode(null, "careful"), "careful");
  assert.equal(effectiveMode(null, undefined), "balanced");
  assert.equal(effectiveMode(null, "nonsense"), "balanced");
});

test("the cycle goes careful, balanced, autopilot, careful", () => {
  assert.equal(nextMode("careful"), "balanced");
  assert.equal(nextMode("balanced"), "autopilot");
  assert.equal(nextMode("autopilot"), "careful");
});

test("the notices name the mode", () => {
  assert.match(modeReport("balanced", false, "balanced"), /the default/);
  assert.match(modeReport("careful", true, "balanced"), /set for this chat/);
  assert.match(modeChanged(null, "balanced"), /default: balanced/);
  assert.match(modeChanged("careful", "balanced"), /^Mode: careful/);
});
