import assert from "node:assert/strict";
import { test } from "node:test";

import type { ModelServerStatus } from "@golem/client";

import { applyServerStatus, serverFailedNotice, startingServer } from "./local-servers.ts";

function status(state: ModelServerStatus["state"], message?: string): ModelServerStatus {
  return { provider: "ollama", base_url: "http://127.0.0.1:11434", state, ...(message === undefined ? {} : { message }) };
}

test("the meter names the session's server only while it starts", () => {
  const starting = applyServerStatus({}, status("starting"));
  assert.equal(startingServer(starting, "ollama"), "ollama");
  assert.equal(startingServer(starting, "anthropic"), null);
  assert.equal(startingServer(starting, null), "ollama");
  const ready = applyServerStatus(starting, status("ready"));
  assert.equal(startingServer(ready, "ollama"), null);
  assert.equal(startingServer({}, null), null);
});

test("only a failed server makes a notice", () => {
  assert.equal(
    serverFailedNotice(status("failed", "ollama serve exited with code 1")),
    "ollama did not start: ollama serve exited with code 1",
  );
  assert.equal(serverFailedNotice(status("failed")), "ollama did not start");
  assert.equal(serverFailedNotice(status("ready")), null);
});
