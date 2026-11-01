import { expect, test } from "vitest";
import { PROTOCOL_MAJOR, PROTOCOL_MINOR, type ConnectionState } from "../../store/connection.ts";
import { connectionScreen } from "./connection-screen.ts";

const screen = (state: ConnectionState) => connectionScreen({ state, daemonVersion: null });

test("connecting", () => {
  expect(screen({ status: "connecting" })).toEqual({
    kind: "connecting",
    tag: "connecting",
    heading: "Connecting to golem",
    sentence: "The page is reaching golem's daemon.",
    command: null,
    golem: "offline",
  });
});

test("unauthorized", () => {
  expect(screen({ status: "unauthorized" })).toMatchObject({
    kind: "unauthorized",
    tag: "unauthorized",
    heading: "This page needs a fresh link",
    command: "golem web",
    golem: "offline",
  });
});

test("rejected shows the protocol and a short reason", () => {
  expect(screen({ status: "rejected", reason: "protocol major mismatch: client 2, daemon 1" })).toMatchObject({
    kind: "mismatch",
    tag: `protocol ${PROTOCOL_MAJOR}.${PROTOCOL_MINOR} · daemon 1`,
    heading: "The daemon is older than this page",
    command: "golem daemon restart",
    golem: "failed",
  });
});

test("a long rejection reason is cut", () => {
  const spec = screen({ status: "rejected", reason: "x".repeat(100) });
  expect(spec?.tag.endsWith("…")).toBe(true);
  expect(spec?.tag.length).toBeLessThan(70);
});

test("reconnecting with 1013 means the daemon is down", () => {
  expect(screen({ status: "reconnecting", attempt: 4, delayMs: 1000, closeCode: 1013 })).toMatchObject({
    kind: "daemon-down",
    tag: "reconnecting · attempt 4",
    heading: "golem's daemon is not running",
    command: "golem daemon start",
    golem: "offline",
  });
});

test("reconnecting with another code means the gateway is down", () => {
  expect(screen({ status: "reconnecting", attempt: 2, delayMs: 1000, closeCode: 1006 })).toMatchObject({
    kind: "gateway-down",
    tag: "reconnecting · attempt 2",
    heading: "golem web is not running",
    command: "golem web",
    golem: "offline",
  });
});

test("reconnecting with no code means the gateway is down", () => {
  expect(screen({ status: "reconnecting", attempt: 1, delayMs: 1000 })?.kind).toBe("gateway-down");
});

test("closed means the gateway is down", () => {
  expect(screen({ status: "closed", reason: "closed" })).toMatchObject({
    kind: "gateway-down",
    tag: "closed",
    heading: "golem web is not running",
    command: "golem web",
  });
});

test("connected has no screen", () => {
  expect(screen({ status: "connected" })).toBeNull();
});
