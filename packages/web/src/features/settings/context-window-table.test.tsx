import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { ModelListResult } from "../../store/models.ts";
import type { RoutingGetResult } from "../../store/routing.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { settingsContextStore } from "./index.ts";
import { localModels, MAX_WINDOW_ROWS, windowCell } from "./context-window-table.tsx";
import { DEFAULT_ROUTING, ROUTING_LISTING } from "./routing-sample.ts";

type Answer = { num_ctx?: number; from?: "golem" | "modelfile" | "ollama"; saved?: Record<string, number> } | "fail";

const ANSWERS: Record<string, Answer> = {
  "ollama/qwen3:8b": { num_ctx: 32768, from: "golem" },
  "ollama/gemma4:e4b": { num_ctx: 16384, from: "golem" },
};

function mount(values: RoutingGetResult, answers: Record<string, Answer> = ANSWERS, listing: ModelListResult = ROUTING_LISTING) {
  history.replaceState(null, "", "/settings/context");
  const fake = fakeClient();
  fake.raw.getRouting.mockResolvedValue(values);
  fake.raw.listModels.mockResolvedValue(listing);
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  fake.raw.getModelOptions.mockImplementation(async (model: string) => {
    const answer = answers[`ollama/${model.replace(/^ollama\//, "")}`];
    if (answer === "fail" || answer === undefined) throw new Error("no options");
    return {
      model,
      options: [],
      defaults: (answer.num_ctx === undefined ? {} : { num_ctx: answer.num_ctx }) as Record<string, number>,
      default_from: (answer.from === undefined ? {} : { num_ctx: answer.from }) as Record<string, "golem" | "modelfile" | "ollama">,
      saved: answer.saved ?? {},
      session: {},
      memory: { ram_gb: 36, size_gb: 5, kv_gb_per_1k_tokens: 0.1, overhead_gb: 1, fits_share: 0.7, tight_share: 0.85 },
    };
  });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake };
}

afterEach(() => {
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
});

const withWindow = (window: RoutingGetResult["context"]["window"]): RoutingGetResult => ({ ...DEFAULT_ROUTING, context: { ...DEFAULT_ROUTING.context, window } });
const table = () => screen.findByRole("table");
/** The rows of the table as `[model, size, window]` texts. */
async function cells(): Promise<string[][]> {
  const rows = within(await table()).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent ?? ""));
}

test("the rows are the installed local models, the one in use first, with its tag", async () => {
  // qwen3:8b is listed first; gemma4:e4b is in use, so it moves up.
  mount({ ...DEFAULT_ROUTING, picked: { ...DEFAULT_ROUTING.picked, local: "ollama/gemma4:e4b" } });
  await waitFor(async () => expect((await cells()).map((row) => row[2])).toEqual(["16Kplanned by golem for this Mac", "32Kplanned by golem for this Mac"]));
  const rows = await cells();
  expect(rows.map((row) => row[0])).toEqual(["gemma4:e4bin use", "qwen3:8b"]);
  expect(rows.map((row) => row[1])).toEqual(["9.6 GB", "5.2 GB"]);
  expect(screen.getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Model on this Mac", "Size", "Window"]);
});

test("Auto shows the planned window", async () => {
  mount(withWindow("auto"));
  await waitFor(async () => expect((await cells()).map((row) => row[2])).toEqual(["32Kplanned by golem for this Mac", "16Kplanned by golem for this Mac"]));
});

test("Fixed shows the number, and cuts it to a model's maximum", async () => {
  const small: ModelListResult = {
    ...ROUTING_LISTING,
    models: ROUTING_LISTING.models.map((model) => (model.ref === "ollama/gemma4:e4b" ? { ...model, ctx: 8192 } : model)),
  };
  mount(withWindow(16384), ANSWERS, small);
  await waitFor(async () => expect((await cells()).map((row) => row[2])).toEqual(["16K", "8K"]));
});

test("Ollama's shows Ollama's default as a forecast in every row", async () => {
  mount(withWindow("ollama"), { "ollama/qwen3:8b": { num_ctx: 4096, from: "ollama" }, "ollama/gemma4:e4b": { num_ctx: 4096, from: "ollama" } });
  await waitFor(async () => expect((await cells()).map((row) => row[2])).toEqual(["≈ 4KOllama's default", "≈ 4KOllama's default"]));
});

test("a model with its own saved window shows it and says so, whatever the choice", async () => {
  mount(withWindow(16384), { ...ANSWERS, "ollama/gemma4:e4b": { num_ctx: 16384, from: "golem", saved: { num_ctx: 4096 } } });
  await waitFor(async () => expect((await cells()).map((row) => row[2])).toEqual(["16K", "4Kset for this model"]));
});

test("a row whose query fails shows a dash, and the page and the other row still work", async () => {
  mount(DEFAULT_ROUTING, { "ollama/qwen3:8b": { num_ctx: 32768, from: "golem" }, "ollama/gemma4:e4b": "fail" });
  await waitFor(async () => expect((await cells()).map((row) => row[2])).toEqual(["32Kplanned by golem for this Mac", "—"]));
  expect(screen.getByRole("heading", { name: "Window size" })).toBeTruthy();
});

test("the Modelfile's and Ollama's window show as a forecast with their source, and none shows a dash with the reason", async () => {
  mount(DEFAULT_ROUTING, { "ollama/qwen3:8b": { num_ctx: 4096, from: "modelfile" }, "ollama/gemma4:e4b": {} });
  await waitFor(async () => expect((await cells()).map((row) => row[2])).toEqual(["≈ 4Kfrom the model's Modelfile", "—"]));
  const dash = (await table()).querySelectorAll("td")[5];
  expect(dash?.getAttribute("title")).toMatch(/^[A-Z].*\.$/);
});

test("a model in use shares its query with the row, so the daemon is asked once for it", async () => {
  const { fake } = mount(DEFAULT_ROUTING);
  await waitFor(async () => expect((await cells()).map((row) => row[2])).toEqual(["32Kplanned by golem for this Mac", "16Kplanned by golem for this Mac"]));
  const asked = fake.raw.getModelOptions.mock.calls.map((call) => String(call[0]));
  expect(asked.filter((model) => model.endsWith("qwen3:8b"))).toHaveLength(1);
});

test("with no local model installed there is no table", async () => {
  const none: ModelListResult = { ...ROUTING_LISTING, models: ROUTING_LISTING.models.filter((model) => model.provider !== "ollama") };
  mount(DEFAULT_ROUTING, ANSWERS, none);
  await screen.findByRole("heading", { name: "Window size" });
  expect(screen.queryByRole("table")).toBeNull();
});

test("at most 12 rows, and a model that is not installed or not Ollama's is left out", () => {
  const many: ModelListResult = {
    ...ROUTING_LISTING,
    models: Array.from({ length: 15 }, (_, index) => ({ ...ROUTING_LISTING.models[0]!, ref: `ollama/m${index}:1b`, profiles: [] })),
  };
  expect(localModels("ollama/m14:1b", many)).toHaveLength(MAX_WINDOW_ROWS);
  expect(localModels("ollama/m14:1b", many)[0]?.ref).toBe("ollama/m14:1b");
  expect(localModels(null, ROUTING_LISTING).map((model) => model.ref)).toEqual(["ollama/qwen3:8b", "ollama/gemma4:e4b"]);
});

test("windowCell: loading and failed rows show a dash, a fixed window has no source", () => {
  expect(windowCell("loading")).toEqual({ text: "—", note: null, title: null });
  expect(windowCell("failed")).toEqual({ text: "—", note: null, title: null });
  expect(windowCell({ tokens: 16384, source: "fixed", estimated: false, reason: null })).toEqual({ text: "16K", note: null, title: null });
  expect(windowCell({ tokens: null, source: null, estimated: false, reason: "golem could not plan one" })).toEqual({ text: "—", note: null, title: "Golem could not plan one." });
});
