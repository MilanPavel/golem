import { OLLAMA_FAILED, RpcError } from "@golem/client";
import { expect, test, vi } from "vitest";
import { isNoModelChosen, sendErrorText } from "./errors.ts";
import { createPage } from "./page.ts";
import { fakeClient, fakeFrame, rpcError } from "./test-support.ts";

function setup() {
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  return { fake, page };
}

test("installOllama gives the output and the end as events, and stops listening at the end", async () => {
  const { fake, page } = setup();
  const events: unknown[] = [];
  await expect(page.actions.installOllama((event) => events.push(event))).resolves.toBe("started");
  fake.emitInstall({ kind: "output", text: "==> Pouring\n" });
  fake.emitInstall({ kind: "done", done: { outcome: "installed" } });
  fake.emitInstall({ kind: "output", text: "late\n" });
  expect(events).toEqual([
    { kind: "output", text: "==> Pouring\n" },
    { kind: "exit", code: 0, stopped: false },
  ]);
});

test("installOllama reads a failure and a stop from the done event", async () => {
  const { fake, page } = setup();
  const events: unknown[] = [];
  await page.actions.installOllama((event) => events.push(event));
  fake.emitInstall({ kind: "done", done: { outcome: "failed", reason: "no space" } });
  expect(events).toEqual([{ kind: "error", message: "no space" }]);
});

test("installOllama says no_brew when the daemon finds no Homebrew, and rethrows any other refusal", async () => {
  const { fake, page } = setup();
  const listener = vi.fn();
  fake.raw.installOllama.mockRejectedValueOnce(new RpcError(OLLAMA_FAILED, "no Homebrew", { no_brew: true }));
  await expect(page.actions.installOllama(listener)).resolves.toBe("no_brew");
  fake.emitInstall({ kind: "output", text: "x" });
  expect(listener).not.toHaveBeenCalled();
  fake.raw.installOllama.mockRejectedValueOnce(new RpcError(OLLAMA_FAILED, "brew failed", { no_brew: false }));
  await expect(page.actions.installOllama(listener)).rejects.toThrow("brew failed");
});

test("cancelOllamaInstall and startOllama call the daemon, and a start makes the listing and the rows stale", async () => {
  const { fake, page } = setup();
  await page.actions.cancelOllamaInstall();
  expect(fake.raw.cancelOllamaInstall).toHaveBeenCalledTimes(1);
  page.queryClient.setQueryData(["model.list"], 1);
  page.queryClient.setQueryData(["setup.status"], 1);
  await expect(page.actions.startOllama()).resolves.toBe(true);
  expect(page.queryClient.getQueryState(["model.list"])?.isInvalidated).toBe(true);
  expect(page.queryClient.getQueryState(["setup.status"])?.isInvalidated).toBe(true);
  fake.raw.startOllama.mockResolvedValueOnce({ running: false });
  await expect(page.actions.startOllama()).resolves.toBe(false);
});

test("refreshModels returns the listing it put in the cache", async () => {
  const { fake, page } = setup();
  const listing = { default: null, models: [], providers: [], setup: { ollama_installed: true, ollama_running: true } };
  fake.raw.listModels.mockResolvedValueOnce(listing);
  await expect(page.actions.refreshModels()).resolves.toBe(listing);
  expect(fake.raw.listModels).toHaveBeenCalledWith(true);
  expect(page.queryClient.getQueryData(["model.list"])).toBe(listing);
});

test("the setup.status query asks the daemon", async () => {
  const { fake, page } = setup();
  fake.raw.setupStatus.mockResolvedValueOnce({ rows: [{ part: "disk", name: "disk", state: "ok", detail: "1 GB" }] });
  await expect(page.queries.setupStatus()).resolves.toEqual({ rows: [{ part: "disk", name: "disk", state: "ok", detail: "1 GB" }] });
});

test("the setup start is decided once", () => {
  const { page } = setup();
  expect(page.setupStart.decided()).toBe(false);
  page.setupStart.decide();
  expect(page.setupStart.decided()).toBe(true);
});

test("a refusal for no model chosen is told apart, and reads as the notice", () => {
  expect(isNoModelChosen(rpcError(-32005, "no model chosen yet"))).toBe(true);
  expect(isNoModelChosen(rpcError(-32005, "model gone"))).toBe(false);
  expect(isNoModelChosen(new Error("no model chosen yet"))).toBe(false);
  expect(sendErrorText(rpcError(-32005, "no model chosen yet"))).toBe("No model yet · pick one, then Enter sends your message");
});
