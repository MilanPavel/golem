import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { FAILED_TRACE, MODEL_DETAIL, SHORT_TRACE, TOOL_DETAIL } from "./sample.ts";
import { SELECT_A_SPAN } from "./trace-screen.tsx";
import type { TraceRunSpan } from "../../store/trace.ts";

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function open(path: string, runs: TraceRunSpan[] = SHORT_TRACE) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: "UTF-8 split", runs } as never);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", "/Users/you/repos/golem"), title: "UTF-8 split", last_seq: 2 });
  });
  await wait();
  return { fake, user: userEvent.setup() };
}

afterEach(() => {
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

test("the page shows the title, the summary line, the tree, and the empty detail", async () => {
  const { fake } = await open("/s/a/trace");
  expect(await within(screen.getByRole("banner")).findByRole("heading", { name: "UTF-8 split" })).toBeTruthy();
  expect(await screen.findByText("1 run · 0m 04.2s · 6.9K tokens · context 3.4K / 128K · 2%")).toBeTruthy();
  expect(screen.getByRole("meter", { name: "Context used" }).getAttribute("aria-valuenow")).toBe("2");
  expect(screen.getAllByRole("treeitem")).toHaveLength(5);
  expect(screen.getByText(SELECT_A_SPAN)).toBeTruthy();
  expect(fake.raw.getTrace).toHaveBeenCalledWith("a");
});

test("the top bar of the chat stays on the trace: title actions, model, folder, and drawer toggle", async () => {
  const { fake, user } = await open("/s/a/trace");
  await screen.findByRole("tree");
  act(() => {
    fake.emitEvent(ev("a", "session.created", { cwd: "/Users/you/repos/golem", model_profile: "local", model_name: "m" }));
  });
  const bar = within(screen.getByRole("banner"));
  expect(bar.getByRole("button", { name: "Model: m" })).toBeTruthy();
  expect(bar.getByText("golem")).toBeTruthy();
  expect(bar.getByRole("button", { name: /^(Show|Hide) details$/ })).toBeTruthy();
  expect(bar.getByRole("button", { name: /^Session actions/ })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Back to chat" }));
  expect(within(screen.getByRole("banner")).getByRole("button", { name: "Model: m" })).toBeTruthy();
  expect(location.pathname).toBe("/s/a");
});

test("a session with no runs says there is nothing to trace, and links back to the chat", async () => {
  await open("/s/a/trace", []);
  expect(await screen.findByText("Nothing to trace yet. Send a message first.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to the chat" }).getAttribute("href")).toBe("/s/a");
});

test("an error says what went wrong and tries again", async () => {
  const { fake, user } = await open("/s/a/trace");
  await screen.findByRole("tree");
  fake.raw.getTrace.mockRejectedValueOnce(new Error("session not found"));
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: null, runs: [] } as never);
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("session not found"));
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Nothing to trace yet. Send a message first.")).toBeTruthy();
});

test("Refresh reads the trace again", async () => {
  const { fake, user } = await open("/s/a/trace");
  await screen.findByRole("tree");
  expect(fake.raw.getTrace).toHaveBeenCalledTimes(1);
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: "UTF-8 split", runs: FAILED_TRACE } as never);
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fake.raw.getTrace).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Run · Run the tests")).toBeTruthy();
});

test("selecting a span puts it in the address without adding to the history, and a link opens it", async () => {
  const { user } = await open("/s/a/trace");
  const before = history.length;
  await user.click(await screen.findByRole("treeitem", { name: /grep/ }));
  expect(location.search).toBe("?span=c_1");
  expect(history.length).toBe(before);
  expect(screen.getByRole("treeitem", { name: /grep/, selected: true })).toBeTruthy();
});

test("a link with a span opens with that span selected", async () => {
  await open("/s/a/trace?span=m_2");
  expect(await screen.findByRole("treeitem", { name: /model 2/, selected: true })).toBeTruthy();
});

test("the page has a Back to chat link and no Chat and Trace tabs", async () => {
  const { user } = await open("/s/a/trace");
  await screen.findByRole("tree");
  expect(screen.queryByRole("navigation", { name: "View" })).toBeNull();
  const back = screen.getByRole("link", { name: "Back to chat" });
  expect(back.getAttribute("href")).toBe("/s/a");
  await user.click(back);
  await waitFor(() => expect(location.pathname).toBe("/s/a"));
  expect(location.search).toBe("");
  expect(screen.queryByRole("tree")).toBeNull();
});

test("the header holds the way back and Refresh, and the summary sits on its own line below", async () => {
  await open("/s/a/trace");
  const back = await screen.findByRole("link", { name: "Back to chat" });
  const row = back.parentElement as HTMLElement;
  expect(within(row).getByRole("button", { name: "Refresh" })).toBeTruthy();
  expect(within(row).queryByText(/runs?/)).toBeNull();
  const summary = screen.getByText(/^1 run · /).parentElement as HTMLElement;
  expect(row.nextElementSibling).toBe(summary.parentElement);
  expect(within(summary).getByRole("meter")).toBeTruthy();
});

test("the page has no accessibility violations", async () => {
  await open("/s/a/trace");
  await screen.findByRole("tree");
  const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
});

test("selecting a model call reads the span and shows its context, then Refresh reads both again", async () => {
  const { fake, user } = await open("/s/a/trace");
  fake.raw.getTraceSpan.mockResolvedValue(MODEL_DETAIL as never);
  await user.click(await screen.findByRole("treeitem", { name: /model 2/ }));
  expect(await screen.findByRole("tab", { name: "Context" })).toBeTruthy();
  expect(fake.raw.getTraceSpan).toHaveBeenCalledWith("a", "m_2");
  expect(screen.queryByText("Select a span to see what went in and what came out.")).toBeNull();
  expect(within(screen.getByRole("region", { name: "Span detail" })).getByRole("list", { name: "Messages" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fake.raw.getTraceSpan).toHaveBeenCalledTimes(2));
  expect(fake.raw.getTrace).toHaveBeenCalledTimes(2);
});

test("a span that cannot be read says why, and tries again", async () => {
  const { fake, user } = await open("/s/a/trace?span=nope");
  fake.raw.getTraceSpan.mockRejectedValueOnce(new Error("span not found"));
  await user.click(await screen.findByRole("treeitem", { name: /grep/ }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("span not found"));
  fake.raw.getTraceSpan.mockResolvedValue(TOOL_DETAIL as never);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("tab", { name: "Args" })).toBeTruthy();
});

test("Open full output reads the artifact a page at a time", async () => {
  const { fake, user } = await open("/s/a/trace");
  const first = "a".repeat(20_000);
  fake.raw.getTraceSpan.mockResolvedValue(TOOL_DETAIL as never);
  fake.raw.readArtifact.mockImplementation(async (_s, _a, offset) =>
    offset === 0 ? { text: first, offset: 0, size: 20_005 } : { text: "tail!", offset: 20_000, size: 20_005 },
  );
  await user.click(await screen.findByRole("treeitem", { name: /read_file/ }));
  await user.click(await screen.findByRole("tab", { name: "Result" }));
  await user.click(screen.getByRole("button", { name: "Open full output" }));
  const dialog = await screen.findByRole("dialog", { name: "Full output" });
  expect(await within(dialog).findByText("20,000 of 20,005 characters")).toBeTruthy();
  expect(fake.raw.readArtifact).toHaveBeenCalledWith("a", "a_9f3c", 0, 20_000);
  await user.click(within(dialog).getByRole("button", { name: "Show more" }));
  expect(await within(dialog).findByText("20,005 of 20,005 characters")).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Show more" })).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Full output" })).toBeNull());
});

test("on a narrow window the span opens as a sheet, and closing it clears the span from the address", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
  const { fake, user } = await open("/s/a/trace");
  fake.raw.getTraceSpan.mockResolvedValue(TOOL_DETAIL as never);
  expect(screen.queryByRole("dialog")).toBeNull();
  await user.click(await screen.findByRole("treeitem", { name: /read_file/ }));
  const sheet = await screen.findByRole("dialog", { name: "Span" });
  expect(await within(sheet).findByRole("tab", { name: "Args" })).toBeTruthy();
  expect(location.search).toBe("?span=c_2");
  await user.click(within(sheet).getByRole("button", { name: "Close span" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(location.search).toBe("");
});
