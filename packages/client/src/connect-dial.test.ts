import assert from "node:assert/strict";
import { test } from "node:test";

import { PROTOCOL_MAJOR, PROTOCOL_MINOR } from "../../protocol/gen/version.ts";
import { connectGolem } from "./connect.ts";
import type { Link } from "./link.ts";

function fakeLink(): Link {
  let onOpen: () => void = () => undefined;
  let onLine: (line: string) => void = () => undefined;
  return {
    send(line) {
      const request = JSON.parse(line) as { method: string; id: number };
      assert.equal(request.method, "hello");
      const result = { daemon_version: "test", protocol_major: PROTOCOL_MAJOR, protocol_minor: PROTOCOL_MINOR };
      queueMicrotask(() => onLine(JSON.stringify({ jsonrpc: "2.0", id: request.id, result })));
    },
    close() {},
    onOpen(listener) {
      onOpen = listener;
      queueMicrotask(() => onOpen());
    },
    onLine(listener) {
      onLine = listener;
    },
    onClose() {},
  };
}

test("the client completes hello over any link", async () => {
  const client = connectGolem({ dial: fakeLink, clientName: "test", reconnect: false });
  await client.ready;
  assert.equal(client.state.status, "connected");
  client.close();
});
