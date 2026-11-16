import { act, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import type { TraceRoute, TraceRunSpan } from "../../store/trace.ts";
import { MODEL_DETAIL, SHORT_TRACE } from "./sample.ts";
import { RouteBlock, SpanDetail } from "./span-detail.tsx";

const ROUTE: TraceRoute = {
  model: "deepseek-chat",
  tier: "budget",
  reason: "fit",
  detail: "did not fit in 32K on ollama/qwen3:27b",
  rejected: [
    { ref: "ollama/qwen3:27b", tier: "local", why: "does not fit: 41.5K of 32K" },
    { ref: "openrouter/mini", tier: "frontier", why: "a paid model needs your OK" },
  ],
};

const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

afterEach(() => {
  history.replaceState(null, "", "/");
  delete document.documentElement.dataset.theme;
});

test("the Route block has the headline and a table of Model, Tier and Result, the picked model first", () => {
  render(<RouteBlock route={ROUTE} mode="auto" />);
  const block = screen.getByRole("region", { name: "Route" });
  expect(within(block).getByRole("heading").textContent).toBe("Route: auto · reason: fit");
  expect(within(block).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Model", "Tier", "Result"]);
  const rows = within(block).getAllByRole("row").slice(1).map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent));
  expect(rows).toEqual([
    ["deepseek-chat", "budget", "picked: did not fit in 32K on ollama/qwen3:27b"],
    ["ollama/qwen3:27b", "local", "does not fit: 41.5K of 32K"],
    ["openrouter/mini", "frontier", "a paid model needs your OK"],
  ]);
});

test("without a mode the headline leaves it out", () => {
  render(<RouteBlock route={ROUTE} mode={null} />);
  expect(screen.getByRole("heading").textContent).toBe("Route · reason: fit");
});

test("a span detail shows the block only when it has a route", () => {
  const { rerender } = render(<SpanDetail result={MODEL_DETAIL} sessionId="s_1" />);
  expect(screen.queryByRole("region", { name: "Route" })).toBeNull();
  rerender(<SpanDetail result={MODEL_DETAIL} sessionId="s_1" route={ROUTE} routeMode="auto" />);
  expect(screen.getByRole("region", { name: "Route" })).toBeTruthy();
});

for (const theme of ["slip", "kiln"]) {
  test(`the block passes axe in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    render(<RouteBlock route={ROUTE} mode="auto" />);
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
}

async function openTrace(path: string, runs: TraceRunSpan[], detail: unknown) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.getTrace.mockResolvedValue({ session_id: "a", title: "UTF-8 split", runs } as never);
  fake.raw.getTraceSpan.mockResolvedValue(detail as never);
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
  act(() => fake.emitEvent(ev("a", "session.updated", { route: "auto" })));
  return fake;
}

test("the trace of a routed run says why the model was picked, with the rejected ones", async () => {
  const [run] = SHORT_TRACE;
  const routed = [{ ...run!, route: ROUTE }] as TraceRunSpan[];
  await openTrace("/s/a/trace?span=r_1", routed, { span: routed[0] });
  const block = await screen.findByRole("region", { name: "Route" });
  await waitFor(() => expect(within(block).getByRole("heading").textContent).toBe("Route: auto · reason: fit"));
  expect(within(block).getByText("openrouter/mini")).toBeTruthy();
});

test("the first model call of a routed run shows it too", async () => {
  const [run] = SHORT_TRACE;
  const routed = [{ ...run!, route: ROUTE }] as TraceRunSpan[];
  await openTrace("/s/a/trace?span=m_1", routed, { ...MODEL_DETAIL, span: routed[0]!.children![0] });
  expect(await screen.findByRole("region", { name: "Route" })).toBeTruthy();
});

test("a run of a pinned session has no block", async () => {
  const fake = await openTrace("/s/a/trace?span=r_1", SHORT_TRACE, { span: SHORT_TRACE[0] });
  await screen.findByRole("tree");
  await waitFor(() => expect(fake.raw.getTraceSpan).toHaveBeenCalled());
  await wait();
  expect(screen.queryByRole("region", { name: "Route" })).toBeNull();
});
