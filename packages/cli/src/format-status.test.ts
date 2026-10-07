import assert from "node:assert/strict";
import { test } from "node:test";

import { formatStatus } from "./format-status.ts";

test("formatStatus prints the fields golem status shows", () => {
  const text = formatStatus({
    pid: 42,
    version: "0.0.0",
    protocol_major: 1,
    protocol_minor: 0,
    uptime_seconds: 12.4,
    state: "running",
  });
  assert.equal(
    text,
    ["connected", "pid: 42", "version: 0.0.0", "protocol: 1.0", "uptime: 12s", "state: running"].join(
      "\n",
    ),
  );
});
