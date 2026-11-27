import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { InboxPanel } from "../inbox/inbox-panel.tsx";
import { queryRowSelector } from "../../store/inbox.ts";
import { QueriesTab } from "./queries-tab.tsx";
import { SAMPLE_BANK } from "./sample.ts";
import { SAMPLE_NOW, SAMPLE_QUERIES } from "./queries-sample.ts";
import { QueryRoutineChip } from "./query-routine-chip.tsx";
import { QueryRoutineForm, type QueryRoutineCreate } from "./query-routine-dialog.tsx";

const BANK = { name: "bank", kind: "files", location: "~/Documents/bank/*.csv" };

function setup(extra: { kind?: string; taken?: string[] } = {}) {
  const onCreate = vi.fn<(create: QueryRoutineCreate) => Promise<unknown>>(async () => undefined);
  const onClose = vi.fn();
  render(<QueryRoutineForm inline source={{ ...BANK, kind: extra.kind ?? "files" }} saved="Big payments this week" taken={extra.taken ?? []} onCreate={onCreate} onClose={onClose} />);
  return { onCreate, onClose };
}

test("Create writes a query routine that posts every time", async () => {
  const user = userEvent.setup();
  const { onCreate, onClose } = setup();
  await user.click(screen.getByRole("radio", { name: /Post the result to the Inbox/ }));
  await user.click(screen.getByRole("button", { name: "Create routine" }));
  expect(onCreate).toHaveBeenCalledWith({
    name: "big-payments-this-week",
    fields: { schedule: "every 1h", query: { source: "bank", saved: "Big payments this week" }, post: "always" },
    summary: false,
  });
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("the default is to post only when it finds rows, every hour", async () => {
  const user = userEvent.setup();
  const { onCreate } = setup();
  await user.click(screen.getByRole("button", { name: "Create routine" }));
  expect(onCreate.mock.calls[0]?.[0].fields).toEqual({ schedule: "every 1h", query: { source: "bank", saved: "Big payments this week" }, post: "rows" });
});

test("a model summary writes the data report workflow with the source and the query as inputs", async () => {
  const user = userEvent.setup();
  const { onCreate } = setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "When" }), "weekdays");
  await user.clear(screen.getByRole("textbox", { name: "Time" }));
  await user.type(screen.getByRole("textbox", { name: "Time" }), "09:15");
  await user.click(screen.getByRole("radio", { name: /Ask a model to write a summary/ }));
  await user.click(screen.getByRole("button", { name: "Create routine" }));
  expect(onCreate).toHaveBeenCalledWith({
    name: "big-payments-this-week",
    fields: { schedule: "15 9 * * 1-5", workflow: "data_report", inputs: { source: "bank", queries: "Big payments this week" } },
    summary: true,
  });
});

test("a new file in the source's folder writes a watch, for a files source only", async () => {
  const user = userEvent.setup();
  const { onCreate } = setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "When" }), "watch");
  expect(screen.getByText("~/Documents/bank")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Create routine" }));
  expect(onCreate.mock.calls[0]?.[0].fields).toEqual({ on: { watch: "~/Documents/bank", glob: "*.csv" }, query: { source: "bank", saved: "Big payments this week" }, post: "rows" });
});

test("a database source has no new-file choice, and a taken name gets a number", () => {
  setup({ kind: "postgres", taken: ["big-payments-this-week"] });
  const options = within(screen.getByRole("combobox", { name: "When" })).getAllByRole("option").map((option) => option.textContent);
  expect(options).not.toContain("When a new file lands in the source's folder");
  expect(screen.getByLabelText("The routine as written").textContent).toContain('name = "big-payments-this-week-2"');
});

test("a time that does not read says so and writes nothing", async () => {
  const user = userEvent.setup();
  const { onCreate } = setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "When" }), "daily");
  await user.clear(screen.getByRole("textbox", { name: "Time" }));
  await user.click(screen.getByRole("button", { name: "Create routine" }));
  expect(onCreate).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("time of day");
});

test("the chip says when and what, and clicking it opens the routine", async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  render(<QueryRoutineChip config={{ name: "big-payments", schedule: "every 1h", query: { source: "bank", saved: "Big payments this week" }, post: "rows" }} onOpen={onOpen} />);
  const chip = screen.getByRole("button", { name: /Open the routine big-payments/ });
  expect(chip.textContent).toBe("⏱ Every hour · only when it finds rows");
  await user.click(chip);
  expect(onOpen).toHaveBeenCalledWith("big-payments");
});

const POST = {
  post_id: "ib_1",
  routine: "big-payments",
  scope: "user",
  source: "bank",
  saved: "Big payments this week",
  row_count: 2,
  columns: ["booked", "description", "paid"],
  rows: [
    ["2026-11-24", "IKEA PRAHA", 812],
    ["2026-11-22", "LETENKY.CZ", 645.3],
  ],
  at: "2026-11-27T10:00:00",
};

test("an Inbox post shows the rows as a table, and its three actions", async () => {
  const user = userEvent.setup();
  const onOpenPostQuery = vi.fn();
  const onAskPost = vi.fn();
  const onDonePost = vi.fn();
  render(<InboxPanel items={[]} posts={[POST]} onAnswer={() => {}} onOpen={() => {}} onOpenPostQuery={onOpenPostQuery} onAskPost={onAskPost} onDonePost={onDonePost} />);
  expect(screen.getByText("big-payments")).toBeTruthy();
  expect(screen.getByText("· 2 rows · bank")).toBeTruthy();
  const table = within(screen.getByRole("group", { name: "The first rows of Big payments this week" }));
  expect(table.getAllByRole("row")).toHaveLength(3);
  expect(table.getByText("IKEA PRAHA")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Open the query/ }));
  await user.click(screen.getByRole("button", { name: /Ask in chat/ }));
  await user.click(screen.getByRole("button", { name: /Done/ }));
  expect(onOpenPostQuery).toHaveBeenCalledWith(POST);
  expect(onAskPost).toHaveBeenCalledWith(POST);
  expect(onDonePost).toHaveBeenCalledWith(POST);
});

test("an Inbox post of a failed run shows the engine's error and no table", () => {
  render(<InboxPanel items={[]} posts={[{ ...POST, row_count: 0, columns: [], rows: [], error: 'column "amout" not found' }]} onAnswer={() => {}} onOpen={() => {}} />);
  expect(screen.getByRole("alert").textContent).toBe('column "amout" not found');
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText("· could not run · bank")).toBeTruthy();
});

test("the Queries tab gives each row an id to scroll to, a Routine button and the chip of its routine", async () => {
  const user = userEvent.setup();
  const first = SAMPLE_QUERIES[0]?.name ?? "";
  const open = vi.fn();
  const create = vi.fn(async () => undefined);
  const routine = { name: "spending", schedule: "0 8 * * 1", query: { source: "bank", saved: first }, post: "always" as const };
  render(
    <QueriesTab
      source={SAMPLE_BANK}
      queries={SAMPLE_QUERIES}
      now={SAMPLE_NOW}
      onRun={() => new Promise<never>(() => {})}
      onTry={() => new Promise<never>(() => {})}
      onAsk={() => {}}
      onSave={async () => undefined}
      onRemove={async () => {}}
      routines={{ routineOf: (saved) => (saved === first ? routine : undefined), names: ["spending"], create, open }}
    />,
  );
  expect(document.querySelector(queryRowSelector(first))).not.toBeNull();
  await user.click(screen.getByRole("button", { name: /Open the routine spending/ }));
  expect(open).toHaveBeenCalledWith("spending");
  await user.click(screen.getByRole("button", { name: `Routine for ${first}` }));
  await user.click(screen.getByRole("button", { name: "Create routine" }));
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
});
