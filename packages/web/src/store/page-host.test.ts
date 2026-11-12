import { expect, test } from "vitest";
import { createPageHost, readPageHost } from "./page-host.ts";

test("kept true and kept false are read with the version", async () => {
  const on = createPageHost(async () => ({ golem: "web", pid: 1, version: "0.5.0", kept: true }));
  await on.refresh();
  expect(on.getSnapshot()).toEqual({ kept: true, version: "0.5.0" });
  const off = createPageHost(async () => ({ kept: false }));
  await off.refresh();
  expect(off.getSnapshot()).toEqual({ kept: false, version: null });
});

test("a failed read, a body with no kept, and a body that is not an object are all unknown", async () => {
  for (const read of [
    async () => {
      throw new Error("offline");
    },
    async () => ({ golem: "web", pid: 1 }),
    async () => ({ kept: "yes" }),
    async () => "ok",
    async () => null,
    async () => 7,
  ]) {
    const host = createPageHost(read);
    await expect(host.refresh()).resolves.toBeUndefined();
    expect(host.getSnapshot()).toEqual({ kept: null, version: null });
  }
  expect(readPageHost(undefined)).toEqual({ kept: null, version: null });
});

test("listeners hear a change, and nothing when the answer is the same", async () => {
  let answer: unknown = { kept: true };
  const host = createPageHost(async () => answer);
  let heard = 0;
  host.subscribe(() => {
    heard += 1;
  });
  await host.refresh();
  await host.refresh();
  expect(heard).toBe(1);
  answer = { kept: false };
  await host.refresh();
  expect(heard).toBe(2);
  answer = {};
  await host.refresh();
  expect(host.getSnapshot().kept).toBeNull();
});
