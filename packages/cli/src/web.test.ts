import assert from "node:assert/strict";
import { test } from "node:test";

import { formatWebOutput, isLiveHealth, isSafeLink, parseWebArgs, webLink } from "./web.ts";

test("parseWebArgs: defaults", () => {
  assert.deepEqual(parseWebArgs([]), { port: 7480, portGiven: false, open: true, json: false });
});

test("parseWebArgs: options", () => {
  assert.deepEqual(parseWebArgs(["--port", "0", "--no-open"]), { port: 0, portGiven: true, open: false, json: false });
  assert.deepEqual(parseWebArgs(["--json", "--port", "65535"]), { port: 65535, portGiven: true, open: false, json: true });
});

test("parseWebArgs: refuses anything else", () => {
  for (const bad of [
    ["--port"],
    ["--port", "65536"],
    ["--port", "-1"],
    ["--port", "1.5"],
    ["--port", "abc"],
    ["--port", "1", "--port", "2"],
    ["--json", "--json"],
    ["--no-open", "--no-open"],
    ["--open"],
    ["extra"],
  ]) {
    assert.equal(parseWebArgs(bad), null, bad.join(" "));
  }
});

test("webLink puts the token in the fragment", () => {
  assert.equal(webLink(7480, "abc_-"), "http://127.0.0.1:7480/#t=abc_-");
});

test("isSafeLink accepts the link and refuses what a script would read differently", () => {
  assert.ok(isSafeLink(webLink(7480, "A".repeat(43))));
  for (const bad of ["", 'http://x/"; do shell script "id', "http://x/ y", "http://x/\n", "http://x/$(id)", "http://x/`id`", "http://x/\\"]) {
    assert.equal(isSafeLink(bad), false, bad);
  }
});

test("isLiveHealth needs golem web and the same pid", () => {
  assert.equal(isLiveHealth({ golem: "web", pid: 5 }, 5), true);
  assert.equal(isLiveHealth({ golem: "web", pid: 6 }, 5), false);
  assert.equal(isLiveHealth({ golem: "daemon", pid: 5 }, 5), false);
  assert.equal(isLiveHealth(null, 5), false);
  assert.equal(isLiveHealth("web", 5), false);
});

const base = { json: false, opened: false, link: "http://127.0.0.1:7480/#t=T", port: 7480, pid: 9, started: false };

test("formatWebOutput: json is one line", () => {
  assert.deepEqual(formatWebOutput({ ...base, json: true, started: true }), [
    '{"url":"http://127.0.0.1:7480/#t=T","port":7480,"pid":9}',
  ]);
});

test("formatWebOutput: no-open prints the link", () => {
  assert.deepEqual(formatWebOutput(base), ["golem web: http://127.0.0.1:7480/#t=T"]);
});

test("formatWebOutput: opened shows the address without the token", () => {
  assert.deepEqual(formatWebOutput({ ...base, opened: true, started: true }), [
    "golem web: http://127.0.0.1:7480 (opened in your browser)",
    "Press Ctrl-C to stop.",
  ]);
});

test("formatWebOutput: a reused gateway has no Ctrl-C line", () => {
  assert.equal(formatWebOutput({ ...base, started: false }).length, 1);
});
