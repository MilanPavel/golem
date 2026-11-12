import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { pickerGroups } from "@golem/view";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { ModelList, type ModelListProps } from "./model-list.tsx";
import { SAMPLE_LISTING, SAMPLE_PULLS } from "./sample.ts";
import { withActivePulls } from "./model-text.ts";

type Extra = Partial<Omit<ModelListProps, "query" | "activeId">>;

/** The list with a query and a selection of its own, as a page would keep them. */
function Harness({
  extra,
  picked,
}: {
  extra: Extra;
  picked: (ref: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const listing = withActivePulls(SAMPLE_LISTING, SAMPLE_PULLS);
  return (
    <ModelList
      listing={listing}
      groups={listing === null ? [] : pickerGroups(listing, query, null)}
      profile="local"
      category={null}
      pulls={SAMPLE_PULLS}
      query={query}
      onQueryChange={setQuery}
      activeId={activeId}
      onActiveChange={setActiveId}
      onActivate={(model) => picked(model.ref)}
      empty={<p>No matching models.</p>}
      {...extra}
    />
  );
}

function setup(extra: Extra = {}) {
  const picked = vi.fn();
  render(<Harness extra={extra} picked={picked} />);
  return { picked, user: userEvent.setup() };
}

const options = () => screen.getAllByRole("option");
const selected = () =>
  options().find((option) => option.getAttribute("aria-selected") === "true");

test("the first row is selected, the arrow keys move it, and Enter picks it", async () => {
  const { picked, user } = setup();
  expect(selected()?.textContent).toContain("qwen3:8b");
  await user.type(
    screen.getByRole("combobox", { name: "Search models" }),
    "{ArrowDown}",
  );
  expect(selected()?.textContent).toContain("claude-sonnet-4");
  await user.keyboard("{Enter}");
  expect(picked).toHaveBeenCalledWith("anthropic/claude-sonnet-4");
});

test("the search keeps the matching rows, and says so when none match", async () => {
  const { user } = setup();
  const field = screen.getByRole("combobox", { name: "Search models" });
  await user.type(field, "gemma");
  expect(options().map((option) => option.textContent)).toEqual([
    expect.stringContaining("Gemma 4 E4B"),
    expect.stringContaining("Gemma 3 12B"),
  ]);
  await user.clear(field);
  await user.type(field, "zzz");
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByText("No matching models.")).toBeTruthy();
});

test("a download row shows its bar, and Stop stops it", async () => {
  const onStop = vi.fn();
  const { picked, user } = setup({ onStop });
  const row = options().find((option) =>
    option.textContent?.includes("Gemma 3 12B"),
  ) as HTMLElement;
  expect(
    within(row).getByRole("progressbar", { name: "Downloading gemma3:12b" }),
  ).toBeTruthy();
  await user.click(within(row).getByText("Stop"));
  expect(onStop).toHaveBeenCalledWith(
    expect.objectContaining({ ref: "ollama/gemma3:12b" }),
  );
  expect(picked).not.toHaveBeenCalled();
});

test("without onStop a download row has no Stop", () => {
  setup();
  expect(screen.queryByText("Stop")).toBeNull();
});

test("a leading group comes first, with its heading, a tag, a reason and a time estimate", () => {
  const listing = SAMPLE_LISTING;
  const fits = listing.models.filter(
    (model) => model.ref === "ollama/qwen3:14b",
  );
  setup({
    leading: { title: "Fits this Mac · 16 GB memory", models: fits },
    notes: new Map([
      [
        "ollama/qwen3:14b",
        {
          tag: "recommended",
          reason: "Strong at code.",
          estimate: "about 12 min",
        },
      ],
    ]),
  });
  const rows = options();
  expect(rows[0]?.textContent).toContain("Qwen3 14B");
  expect(rows[0]?.textContent).toContain("recommended");
  expect(rows[0]?.textContent).toContain("Strong at code.");
  expect(rows[0]?.textContent).toContain("9.3 GB fits · about 12 min");
  expect(screen.getByText("Fits this Mac · 16 GB memory")).toBeTruthy();
  // The model is listed once, not again under its own group.
  expect(
    rows.filter((row) => row.textContent?.includes("Qwen3 14B")),
  ).toHaveLength(1);
});

test("a collapsed tail shows the first rows, and Show all N models lists the rest", async () => {
  const { user } = setup({ collapse: { keep: 3 } });
  const all = SAMPLE_LISTING.models.length;
  expect(options()).toHaveLength(3);
  await user.click(
    screen.getByRole("button", { name: `Show all ${all} models` }),
  );
  expect(options()).toHaveLength(all);
  expect(screen.queryByRole("button", { name: /^Show all/ })).toBeNull();
});
