import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { resolveActive, SearchList, type SearchListItem } from "./search-list.tsx";

type Item = SearchListItem & { name: string };

const ITEMS: Item[] = [
  { id: "a", group: "Fruit", name: "Apple" },
  { id: "b", group: "Fruit", name: "Banana" },
  { id: "c", group: "Veg", name: "Carrot" },
];

function Harness({ items = ITEMS, onActivate = () => {} }: { items?: Item[]; onActivate?: (item: Item) => void }) {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <SearchList
      items={items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))}
      label="Search things"
      query={query}
      onQueryChange={setQuery}
      activeId={activeId}
      onActiveChange={setActiveId}
      onActivate={onActivate}
      renderItem={(item) => item.name}
      empty={<p>Nothing.</p>}
      after={<p>After the list</p>}
    />
  );
}

test("resolveActive keeps the named item, else the first", () => {
  expect(resolveActive(ITEMS, "b")?.id).toBe("b");
  expect(resolveActive(ITEMS, "gone")?.id).toBe("a");
  expect(resolveActive(ITEMS, null)?.id).toBe("a");
  expect(resolveActive([], "a")).toBeNull();
});

test("items sit in groups named by a visible heading", () => {
  render(<Harness />);
  const groups = screen.getAllByRole("group");
  expect(groups.map((group) => group.getAttribute("aria-label") ?? document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["Fruit", "Veg"]);
  expect(within(groups[0]!).getAllByRole("option")).toHaveLength(2);
  expect(screen.getByText("After the list")).toBeTruthy();
});

test("the arrow keys move the active option from the field, and Enter picks it", async () => {
  const user = userEvent.setup();
  const onActivate = vi.fn();
  render(<Harness onActivate={onActivate} />);
  const box = screen.getByRole("combobox", { name: "Search things" });
  expect(document.activeElement).toBe(box);
  await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  expect(box.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Carrot" }).id);
  await user.keyboard("{Enter}");
  expect(onActivate).toHaveBeenCalledWith(ITEMS[2]);
  await user.keyboard("{Home}");
  expect(screen.getByRole("option", { name: "Apple" }).getAttribute("aria-selected")).toBe("true");
});

test("keys with a modifier are left to the page", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.keyboard("{Meta>}{ArrowDown}{/Meta}");
  expect(screen.getByRole("option", { name: "Apple" }).getAttribute("aria-selected")).toBe("true");
});

test("nothing to show leaves the combobox closed and shows the empty message", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.type(screen.getByRole("combobox"), "zzz");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByText("Nothing.")).toBeTruthy();
  expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("combobox").hasAttribute("aria-controls")).toBe(false);
});

for (const theme of ["slip", "kiln"]) {
  test(`no accessibility violations in ${theme}`, async () => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(<main><Harness /></main>);
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
    delete document.documentElement.dataset.theme;
  });
}
