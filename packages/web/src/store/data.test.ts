import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { dataAnswer, dataDescribeKey, dataErrorText, DATA_LIST_KEY } from "./data.ts";
import { createPage } from "./page.ts";
import { keepQueriesHonest } from "./query.ts";
import { fakeClient, fakeFrame, rpcError } from "./test-support.ts";

function build() {
  const fake = fakeClient();
  const page = createPage(fake.client, { frame: fakeFrame(), doc: new EventTarget() as unknown as Document });
  return { fake, page };
}

const SOURCE = { name: "bank", kind: "files", scope: "user", location: "~/b/*.csv", privacy: "local", status: "ready" } as const;

test("list and describe read through the client, and a source's table is its own key", async () => {
  const { fake, page } = build();
  fake.raw.listData.mockResolvedValue({ sources: [SOURCE] });
  expect(await page.queries.dataList()).toEqual({ status: "ready", data: { sources: [SOURCE] } });
  await page.queries.dataDescribe("bank", null);
  await page.queries.dataDescribe("bank", "transactions");
  expect(fake.raw.describeData.mock.calls).toEqual([["bank"], ["bank", "transactions"]]);
  expect(dataDescribeKey("bank")).not.toEqual(dataDescribeKey("bank", "transactions"));
});

test("a method the daemon does not know is a state, any other failure is thrown", async () => {
  const { fake, page } = build();
  fake.raw.listData.mockRejectedValue(rpcError(-32601, "method not found"));
  expect(await page.queries.dataList()).toEqual({ status: "missing" });
  fake.raw.getDataNotes.mockRejectedValue(rpcError(-32601, "method not found"));
  expect(await page.queries.dataNotes("bank")).toEqual({ status: "missing" });
  fake.raw.describeData.mockRejectedValue(new Error("boom"));
  await expect(page.queries.dataDescribe("bank", null)).rejects.toThrow("boom");
  await expect(dataAnswer(() => Promise.reject(rpcError(-32602, "bad")))).rejects.toThrow("bad");
  expect(dataErrorText(rpcError(-32601, "x"), "f")).toContain("Update golem");
  expect(dataErrorText(new Error("no such file"), "f")).toBe("no such file");
});

test("add, update, remove and the notes actions call the client, and a change marks the list stale", async () => {
  const { fake, page } = build();
  page.queryClient.setQueryData([...DATA_LIST_KEY], 1);
  fake.raw.addData.mockResolvedValue({ source: SOURCE });
  const added = await page.actions.dataAdd({ name: "bank", location: "~/b/*.csv", privacy: "local", scope: "user", password: "pw" });
  expect(added.name).toBe("bank");
  expect(fake.raw.addData).toHaveBeenCalledWith({ name: "bank", location: "~/b/*.csv", privacy: "local", scope: "user", password: "pw" });
  expect(page.queryClient.getQueryState([...DATA_LIST_KEY])?.isInvalidated).toBe(true);
  await page.actions.dataUpdate({ name: "bank", privacy: "schema" });
  expect(fake.raw.updateData).toHaveBeenCalledWith({ name: "bank", privacy: "schema" });
  await page.actions.dataRemove("bank");
  expect(fake.raw.removeData).toHaveBeenCalledWith("bank");
  expect(await page.actions.dataNotesSet("bank", "# hi")).toBe("~/.golem/data/x.md");
  expect(await page.actions.dataNotesDraft("bank")).toBe("# x\n");
  expect(await page.actions.dataInspect("~/b/*.csv")).toMatchObject({ suggested_name: "x" });
});

test("a failed add still marks the list stale, and its reason is thrown", async () => {
  const { fake, page } = build();
  page.queryClient.setQueryData([...DATA_LIST_KEY], 1);
  fake.raw.addData.mockRejectedValue(new Error("bad password"));
  await expect(page.actions.dataAdd({ name: "x", location: "pg://x", privacy: "open", scope: "project" })).rejects.toThrow("bad password");
  expect(page.queryClient.getQueryState([...DATA_LIST_KEY])?.isInvalidated).toBe(true);
});

test("data.changed marks the list and that source stale; with no source, every description", () => {
  const fake = fakeClient();
  const queryClient = new QueryClient();
  const keys = [[...DATA_LIST_KEY], ["data.describe", "bank"], ["data.describe", "logs"], ["data.notes.get", "bank"]] as const;
  for (const key of keys) queryClient.setQueryData([...key], 1);
  const stale = () => keys.filter((key) => queryClient.getQueryState([...key])?.isInvalidated).map((key) => key.join(":"));
  const off = keepQueriesHonest(fake.client, queryClient);
  fake.emitData({ reason: "notes", source: "bank" });
  expect(stale()).toEqual(["data.list", "data.describe:bank", "data.notes.get:bank"]);
  fake.emitData({ reason: "added", source: null });
  expect(stale()).toHaveLength(4);
  off();
});
