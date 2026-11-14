import assert from "node:assert/strict";
import { test } from "node:test";

import { type Check, doctorExitCode, runDoctor, webCheck, type WebJobFacts } from "./doctor.ts";

const FACTS: WebJobFacts = {
  cliVersion: "0.3.0",
  plist: true,
  program: "/opt/homebrew/opt/golem/bin/golem",
  programExists: true,
  loaded: true,
  live: { port: 7480, version: "0.3.0" },
};

test("web: no plist is fine", () => {
  const check = webCheck({ ...FACTS, plist: false, program: null, loaded: false, live: null });
  assert.deepEqual(check, {
    name: "web",
    status: "ok",
    detail: "not kept running · golem opens it when you ask",
  });
});

test("web: a loaded job that answers", () => {
  assert.deepEqual(webCheck(FACTS), {
    name: "web",
    status: "ok",
    detail: "launchd keeps the page at http://127.0.0.1:7480 · version 0.3.0",
  });
});

test("web: loaded, but the page does not answer", () => {
  const check = webCheck({ ...FACTS, live: null });
  assert.equal(check.status, "warn");
  assert.equal(check.detail, "the job is loaded but the page does not answer");
  assert.equal(check.fix, "tail ~/.golem/logs/web.stderr.log");
});

test("web: installed but not loaded", () => {
  const check = webCheck({ ...FACTS, loaded: false, live: null });
  assert.equal(check.status, "warn");
  assert.equal(check.detail, "installed, but stopped");
  assert.equal(check.fix, "golem web install");
});

test("web: the plist names a program that is gone", () => {
  const check = webCheck({ ...FACTS, programExists: false, loaded: false });
  assert.equal(check.status, "warn");
  assert.equal(check.detail, "the job runs /opt/homebrew/opt/golem/bin/golem, which is gone");
  assert.equal(check.fix, "golem web install");
});

test("web: a live gateway older than this golem", () => {
  const check = webCheck({ ...FACTS, live: { port: 7480, version: "0.2.0" } });
  assert.equal(check.status, "warn");
  assert.equal(check.detail, "the page is served by golem 0.2.0, this golem is 0.3.0");
  assert.equal(check.fix, "golem");
  assert.equal(webCheck({ ...FACTS, live: { port: 7480, version: undefined } }).detail, "the page is served by an older golem, this golem is 0.3.0");
});

test("web never makes golem doctor fail", () => {
  const cases: WebJobFacts[] = [
    FACTS,
    { ...FACTS, plist: false },
    { ...FACTS, live: null },
    { ...FACTS, loaded: false },
    { ...FACTS, programExists: false },
    { ...FACTS, live: { port: 7480, version: "0.1.0" } },
  ];
  for (const facts of cases) {
    const check = webCheck(facts);
    assert.notEqual(check.status, "fail");
    assert.equal(doctorExitCode([{ name: "service", status: "ok", detail: "" }, check]), 0);
  }
});

test("the web line goes after running", async () => {
  const web: Check = webCheck(FACTS);
  const checks = await runDoctor({
    cliVersion: "0.3.0",
    located: { command: "/d", args: [] },
    daemonChecks: async () => [
      { name: "service", status: "ok", detail: "x", fix: null },
      { name: "config", status: "ok", detail: "y", fix: null },
    ],
    readStatus: async () => null,
    web: async () => web,
  });
  assert.deepEqual(
    checks.map((check) => check.name),
    ["daemon", "service", "running", "web", "config"],
  );
});
