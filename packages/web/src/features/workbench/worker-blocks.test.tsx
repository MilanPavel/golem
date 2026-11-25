import { workerFixture } from "@golem/view";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, rpcError } from "../../store/test-support.ts";
import { changesViewStore } from "./changes-view.tsx";
import { ChangesTab } from "./changes-tab.tsx";

const CONFLICT = -32027;

function setup(events: ReturnType<typeof workerFixture>) {
  changesViewStore.set("file");
  const fake = fakeClient();
  fake.raw.listAgents.mockImplementation(async () => ({
    agents: [{ name: "coder", description: "", origin: "user", wish: "same", changing_tools: ["edit_file"] }],
  }));
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }) as unknown as Document;
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  render(
    <PageProvider page={page}>
      <ChangesTab sessionId="lead" />
    </PageProvider>,
  );
  act(() => {
    for (const event of events) fake.emitEvent(event);
  });
  return fake;
}

const block = (label: string): HTMLElement => {
  const item = screen.getByText(label).closest("li");
  if (item === null) throw new Error(`no block for ${label}`);
  return item;
};

test("draws one block per worker, with the checks line, the stat and the footer", async () => {
  setup(workerFixture());
  const first = block("httpx");
  expect(within(first).getByText("tests pass")).toBeTruthy();
  expect(within(first).getByText("+38 −12")).toBeTruthy();
  expect(within(first).getByRole("button", { name: "Apply" })).toBeTruthy();
  expect(within(block("sqlmodel")).getByRole("button", { name: "Try again, stronger" })).toBeTruthy();
  expect(within(block("pydantic")).getByRole("button", { name: "Discard" })).toBeTruthy();
  // The running one shows once the agent list says its type writes.
  await waitFor(() => {
    expect(block("trio").dataset["status"]).toBe("running");
  });
  expect(screen.getByText(/in copies · nothing in the folder has changed/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Apply the 2 green" })).toBeTruthy();
});

test("draws nothing when there are no workers", () => {
  setup([]);
  expect(screen.queryByRole("region", { name: "Workers" })).toBeNull();
});

test("Apply sends helper.apply with the session and helper ids", async () => {
  const fake = setup(workerFixture());
  await userEvent.click(within(block("aiohttp")).getByRole("button", { name: "Apply" }));
  expect(fake.raw.applyHelper).toHaveBeenCalledExactlyOnceWith("lead", "h1");
});

test("a conflict shows the path in that block", async () => {
  const fake = setup(workerFixture());
  fake.raw.applyHelper.mockRejectedValueOnce(rpcError(CONFLICT, "conflict", { path: "src/a.py" }));
  await userEvent.click(within(block("httpx")).getByRole("button", { name: "Apply" }));
  expect(await within(block("httpx")).findByText("src/a.py changed since the worker copied it")).toBeTruthy();
  expect(within(block("aiohttp")).queryByRole("alert")).toBeNull();
});

test("Apply the green applies in order", async () => {
  const fake = setup(workerFixture());
  await userEvent.click(screen.getByRole("button", { name: "Apply the 2 green" }));
  await waitFor(() => {
    expect(fake.raw.applyHelper.mock.calls).toEqual([
      ["lead", "h0"],
      ["lead", "h1"],
    ]);
  });
});

test("Apply the green stops at the first conflict", async () => {
  const fake = setup(workerFixture());
  fake.raw.applyHelper.mockRejectedValueOnce(rpcError(CONFLICT, "conflict", { path: "b.py" }));
  await userEvent.click(screen.getByRole("button", { name: "Apply the 2 green" }));
  expect(await within(block("httpx")).findByText("b.py changed since the worker copied it")).toBeTruthy();
  expect(fake.raw.applyHelper).toHaveBeenCalledExactlyOnceWith("lead", "h0");
});

test("Try again, stronger sends helper.retry and Discard sends helper.discard", async () => {
  const fake = setup(workerFixture());
  await userEvent.click(within(block("sqlmodel")).getByRole("button", { name: "Try again, stronger" }));
  expect(fake.raw.retryHelper).toHaveBeenCalledExactlyOnceWith("lead", "h2");
  await userEvent.click(within(block("pydantic")).getByRole("button", { name: "Discard" }));
  expect(fake.raw.discardHelper).toHaveBeenCalledExactlyOnceWith("lead", "h3");
});

test("View opens the diff artifact in the diff view", async () => {
  const fake = setup(workerFixture());
  fake.raw.readArtifact.mockImplementation(async () => ({ text: "--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-old\n+new\n", offset: 0, size: 40, next_offset: null }) as never);
  await userEvent.click(within(block("httpx")).getByRole("button", { name: "View" }));
  await waitFor(() => {
    expect(fake.raw.readArtifact).toHaveBeenCalled();
  });
  expect(fake.raw.readArtifact.mock.calls[0]?.[1]).toBe("a0");
});
