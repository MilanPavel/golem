import assert from "node:assert/strict";
import { test } from "node:test";
import { noBrowser, routeDefault } from "./dispatch.ts";

const none = {};

test("bare golem opens the web UI and shows the hint", () => {
  const route = routeDefault([], none);
  assert.ok(route?.kind === "web" && route.args.open && route.hint && !route.args.serve);
});

test("--no-open and --json open nothing and show no hint", () => {
  for (const flag of ["--no-open", "--json"]) {
    const route = routeDefault([flag], none);
    assert.ok(route?.kind === "web" && !route.args.open && !route.hint);
  }
});

test("--port is passed on", () => {
  const route = routeDefault(["--port", "7000"], none);
  assert.ok(route?.kind === "web" && route.args.port === 7000 && route.hint);
});

test("tui opens the terminal chat, and only alone", () => {
  assert.deepEqual(routeDefault(["tui"], none), { kind: "tui" });
  assert.equal(routeDefault(["tui", "--json"], none), null);
});

test("web, serve and other commands are not the default route", () => {
  for (const args of [["web"], ["web", "--json"], ["serve"], ["status"], ["--port"], ["--port", "x"], ["--bogus"]]) {
    assert.equal(routeDefault(args, none), null, args.join(" "));
  }
});

test("noBrowser is true only when SSH_CONNECTION is set and not empty", () => {
  assert.equal(noBrowser({ SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22" }), true);
  assert.equal(noBrowser({ SSH_CONNECTION: "" }), false);
  assert.equal(noBrowser({}), false);
});

test("SSH_CONNECTION means --no-open and no hint", () => {
  const route = routeDefault([], { SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22" });
  assert.ok(route?.kind === "web" && !route.args.open && !route.hint);
});
