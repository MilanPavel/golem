import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { createQueryClient, keepQueriesHonest } from "./query.ts";
import { ev, fakeClient, summary } from "./test-support.ts";

const KEYS = [
  ["skill.list"],
  ["mcp.list"],
  ["mcp.tools", "fs"],
  ["model.list"],
  ["session.inspect", "a"],
  ["session.inspect", "b"],
  ["daemon.status"],
] as const;

function setup(status: "connecting" | "connected" = "connecting") {
  const fake = fakeClient();
  if (status === "connected") fake.setState({ status: "connected" });
  const queryClient = new QueryClient();
  for (const key of KEYS) queryClient.setQueryData([...key], 1);
  const off = keepQueriesHonest(fake.client, queryClient);
  const stale = () =>
    KEYS.filter((key) => queryClient.getQueryState([...key])?.isInvalidated).map((key) => key.join(":"));
  return { fake, queryClient, off, stale };
}

test("the query client keeps answers fresh and does not refetch on focus", () => {
  const defaults = createQueryClient().getDefaultOptions().queries;
  expect(defaults).toMatchObject({ staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 });
});

test("skills changed marks skill.list", () => {
  const { fake, stale } = setup();
  fake.emitSkills("/repo");
  expect(stale()).toEqual(["skill.list"]);
});

test("mcp status marks mcp.list and mcp.tools", () => {
  const { fake, stale } = setup();
  fake.emitMcp();
  expect(stale()).toEqual(["mcp.list", "mcp.tools:fs"]);
});

test("a finished pull marks model.list, progress does not", () => {
  const { fake, stale } = setup();
  fake.emitPull({ kind: "progress", progress: {} } as never);
  expect(stale()).toEqual([]);
  fake.emitPull({ kind: "done", done: {} } as never);
  expect(stale()).toEqual(["model.list"]);
});

test("session.updated and a summary mark only that session's inspect", () => {
  const { fake, stale } = setup();
  fake.emitEvent(ev("a", "session.updated", { title: "T" }));
  expect(stale()).toEqual(["session.inspect:a"]);
  fake.emitEvent(ev("b", "run.completed", {}));
  expect(stale()).toEqual(["session.inspect:a"]);
  fake.emitSummary(summary("b", "2026-11-01T10:00:00Z"));
  expect(stale()).toEqual(["session.inspect:a", "session.inspect:b"]);
});

test("the first connect marks nothing, a reconnect marks everything", () => {
  const { fake, stale } = setup();
  fake.setState({ status: "connected" });
  expect(stale()).toEqual([]);
  fake.setState({ status: "reconnecting", attempt: 1, delayMs: 0 });
  expect(stale()).toEqual([]);
  fake.setState({ status: "connected" });
  expect(stale()).toHaveLength(KEYS.length);
});

test("the unsubscribe stops every wiring", () => {
  const { fake, off, stale } = setup();
  off();
  fake.emitSkills();
  fake.emitMcp();
  expect(stale()).toEqual([]);
});
