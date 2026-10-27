import assert from "node:assert/strict";
import { test } from "node:test";

import { formatLocalServer, formatStatus } from "./format-status.ts";

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

test("formatStatus adds a line for each local model server", () => {
  const text = formatStatus({
    pid: 42,
    version: "0.0.0",
    protocol_major: 2,
    protocol_minor: 24,
    uptime_seconds: 1,
    state: "running",
    local_servers: [
      { provider: "ollama", base_url: "http://127.0.0.1:11434", owner: "golem", pid: 49080, memory_mb: 5324.8 },
      { provider: "lan", base_url: "http://localhost:11500", owner: "external" },
    ],
  });
  assert.deepEqual(text.split("\n").slice(-2), [
    "ollama: started by golem, pid 49080, 5.2 GB",
    "lan: running, not started by golem",
  ]);
});

test("a small server's memory is in MB", () => {
  assert.equal(
    formatLocalServer({ provider: "ollama", base_url: "http://127.0.0.1:11434", owner: "golem", pid: 7, memory_mb: 61.4 }),
    "ollama: started by golem, pid 7, 61 MB",
  );
});
