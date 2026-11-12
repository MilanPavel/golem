import assert from "node:assert/strict";
import { test } from "node:test";

import { isSecretShape, randomSecret } from "@golem/gateway";

import { FIRST_RUN_LINE, formatWebOutput, isLiveHealth, isSafeLink, parseWebArgs, parseWebJobArgs, webLink } from "./web.ts";

test("parseWebJobArgs: install, uninstall, and nothing else", () => {
  assert.deepEqual(parseWebJobArgs(["install"]), { kind: "install", port: null });
  assert.deepEqual(parseWebJobArgs(["install", "--port", "7500"]), { kind: "install", port: 7500 });
  assert.deepEqual(parseWebJobArgs(["uninstall"]), { kind: "uninstall", port: null });
  for (const bad of [[], ["serve"], ["install", "--port"], ["install", "--port", "0"], ["install", "--port", "70000"], ["install", "--json"], ["uninstall", "--port", "1"]]) {
    assert.equal(parseWebJobArgs(bad), null, bad.join(" "));
  }
});

test("formatWebOutput: the first-run line only after a reuse, never with Ctrl-C", () => {
  const base = { json: false, opened: true, link: "", port: 7480, pid: 9 };
  assert.equal(FIRST_RUN_LINE, "Setup continues in your browser. You can close this window.");
  assert.deepEqual(formatWebOutput({ ...base, started: false, firstRun: true }), [
    "golem web: http://127.0.0.1:7480 (opened in your browser)",
    FIRST_RUN_LINE,
  ]);
  assert.deepEqual(formatWebOutput({ ...base, started: false }), ["golem web: http://127.0.0.1:7480 (opened in your browser)"]);
  assert.deepEqual(formatWebOutput({ ...base, started: true, firstRun: true }), [
    "golem web: http://127.0.0.1:7480 (opened in your browser)",
    "Press Ctrl-C to stop.",
  ]);
});

test("parseWebArgs: serve", () => {
  assert.deepEqual(parseWebArgs(["serve"]), { port: 7480, portGiven: false, open: false, json: false, serve: true });
  assert.deepEqual(parseWebArgs(["serve", "--port", "8000"]), { port: 8000, portGiven: true, open: false, json: false, serve: true });
  for (const bad of [["serve", "--json"], ["serve", "--no-open"], ["serve", "serve"], ["serve", "--port"], ["--port", "1", "serve"]]) {
    assert.equal(parseWebArgs(bad), null, bad.join(" "));
  }
});

test("isLiveHealth accepts an answer with no version", () => {
  assert.equal(isLiveHealth({ golem: "web", pid: 5 }, 5), true);
  assert.equal(isLiveHealth({ golem: "web", pid: 5, version: "1.2.3", kept: true }, 5), true);
});

test("formatWebOutput: serve is one line with no link and no token", () => {
  const token = randomSecret();
  const lines = formatWebOutput({
    json: false,
    opened: false,
    link: `http://127.0.0.1:7480/#t=${token}`,
    port: 7480,
    pid: 9,
    started: true,
    serve: true,
  });
  assert.deepEqual(lines, ["golem web: serving http://127.0.0.1:7480"]);
  assert.equal(lines.join("\n").includes(token), false);
  assert.equal(lines.some((l) => l.split(/[\s/#=]+/).some(isSecretShape)), false);
});

test("parseWebArgs: defaults", () => {
  assert.deepEqual(parseWebArgs([]), { port: 7480, portGiven: false, open: true, json: false, serve: false });
});

test("parseWebArgs: options", () => {
  assert.deepEqual(parseWebArgs(["--port", "0", "--no-open"]), { port: 0, portGiven: true, open: false, json: false, serve: false });
  assert.deepEqual(parseWebArgs(["--json", "--port", "65535"]), { port: 65535, portGiven: true, open: false, json: true, serve: false });
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
