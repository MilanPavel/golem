import { expect, test } from "vitest";
import { createPage } from "./page.ts";
import { fakeClient, fakeFrame } from "./test-support.ts";

const REF = "ollama/qwen3:8b";

function setup() {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  return { fake, page };
}

test("useModel calls the daemon and changes nothing itself", async () => {
  const { fake, page } = setup();
  await page.actions.useModel("a", REF);
  expect(fake.raw.setSessionModel).toHaveBeenCalledWith("a", REF);
});

test("setDefault and remove make the listing stale", async () => {
  const { fake, page } = setup();
  page.queryClient.setQueryData(["model.list"], 1);
  await page.actions.setDefault("local");
  expect(fake.raw.setDefaultModel).toHaveBeenCalledWith("local");
  expect(page.queryClient.getQueryState(["model.list"])?.isInvalidated).toBe(true);
  page.queryClient.setQueryData(["model.list"], 2);
  expect(page.queryClient.getQueryState(["model.list"])?.isInvalidated).toBe(false);
  await page.actions.remove(REF);
  expect(fake.raw.deleteModel).toHaveBeenCalledWith(REF);
  expect(page.queryClient.getQueryState(["model.list"])?.isInvalidated).toBe(true);
});

test("a refused setDefault leaves the listing alone", async () => {
  const { fake, page } = setup();
  page.queryClient.setQueryData(["model.list"], 1);
  fake.raw.setDefaultModel.mockRejectedValueOnce(new Error("no"));
  await expect(page.actions.setDefault("x")).rejects.toThrow("no");
  expect(page.queryClient.getQueryState(["model.list"])?.isInvalidated).toBe(false);
});

test("refreshModels asks past the cache and stores the answer", async () => {
  const { fake, page } = setup();
  const fresh = { default: "x", models: [], providers: [], setup: { ollama_installed: true, ollama_running: true } };
  fake.raw.listModels.mockResolvedValueOnce(fresh);
  await page.actions.refreshModels();
  expect(fake.raw.listModels).toHaveBeenCalledWith(true, false);
  expect(page.queryClient.getQueryData(["model.list"])).toBe(fresh);
});

test("the listing query asks the daemon without refreshing", async () => {
  const { fake, page } = setup();
  await page.queries.modelList();
  expect(fake.raw.listModels).toHaveBeenCalledWith(false, false);
});

test("pull shows the row at once, and with a session it switches it when the download ends well", async () => {
  const { fake, page } = setup();
  await page.actions.pull(REF, { sessionId: "a" });
  expect(fake.raw.pullModel).toHaveBeenCalledWith(REF);
  expect(page.pulls.getSnapshot().active.get(REF)?.status).toBe("starting");
  fake.emitPull({ kind: "done", done: { ref: REF, ok: true, error: null } });
  expect(fake.raw.setSessionModel).toHaveBeenCalledWith("a", REF);
  expect(page.pulls.getSnapshot().active.size).toBe(0);
});

test("a pull without a session leaves every session alone", async () => {
  const { fake, page } = setup();
  await page.actions.pull(REF);
  fake.emitPull({ kind: "done", done: { ref: REF, ok: true, error: null } });
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
});

test("a refused pull takes its row and its wish back", async () => {
  const { fake, page } = setup();
  fake.raw.pullModel.mockRejectedValueOnce(new Error("no"));
  await expect(page.actions.pull(REF, { sessionId: "a" })).rejects.toThrow("no");
  expect(page.pulls.getSnapshot().active.size).toBe(0);
  fake.emitPull({ kind: "done", done: { ref: REF, ok: true, error: null } });
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
});

test("stopping a download drops the wish to switch", async () => {
  const { fake, page } = setup();
  await page.actions.pull(REF, { sessionId: "a" });
  await page.actions.cancelPull(REF);
  expect(fake.raw.cancelPull).toHaveBeenCalledWith(REF);
  fake.emitPull({ kind: "done", done: { ref: REF, ok: true, error: null } });
  expect(fake.raw.setSessionModel).not.toHaveBeenCalled();
});

test("the pulls store follows the page's start and stop", () => {
  const { fake, page } = setup();
  fake.emitPull({ kind: "progress", progress: { ref: REF, status: "pulling", completed: 1, total: 2, progress: 0.5 } });
  expect(page.pulls.getSnapshot().active.size).toBe(1);
  page.stop();
  expect(page.pulls.getSnapshot().active.size).toBe(0);
  fake.emitPull({ kind: "progress", progress: { ref: REF, status: "pulling", completed: 1, total: 2, progress: 0.5 } });
  expect(page.pulls.getSnapshot().active.size).toBe(0);
});
