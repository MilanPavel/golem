import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { Rail } from "../sidebar/rail.tsx";
import type { DataSource } from "../../store/data.ts";
import { DataIcon } from "../../ui/icons.tsx";
import { DataPanel } from "./index.ts";
import { SAMPLE_BANK, SAMPLE_BUILTIN, SAMPLE_FOLDER, SAMPLE_SHOP_DEV } from "./sample.ts";

test("the Data panel draws an icon, not a glyph, for each source", () => {
  const base: DataSource = { ...SAMPLE_BANK, watch: false };
  const sources: DataSource[] = [SAMPLE_BUILTIN, SAMPLE_BANK, SAMPLE_SHOP_DEV, { ...base, name: "archive", kind: "sqlite", location: "a.db" }, { ...base, name: "web", kind: "url", location: "https://example.com/a.csv" }];
  render(<DataPanel answer={{ status: "ready", data: { sources } }} folder={SAMPLE_FOLDER} selected={null} onNavigate={() => {}} onAdd={() => {}} />);
  for (const source of sources) {
    const row = within(screen.getByText(source.name).closest("a") as HTMLElement);
    expect(row.queryByText(/^(◆|▤|⌁|db)$/)).toBeNull();
  }
  expect(document.querySelectorAll("li svg").length).toBe(sources.length);
});

test("the rail's Data item draws the database icon", () => {
  render(<Rail state="idle" version="0.9.1" connected="connected" picked="data" inboxCount={0} settingsDot={false} label="Rail" onPick={() => {}} onNew={() => {}} onSearch={() => {}} onSettings={() => {}} />);
  const reference = render(<DataIcon />).container.querySelector("svg")?.innerHTML;
  const button = within(screen.getByRole("navigation", { name: "Rail" })).getByRole("button", { name: /^Data/ });
  expect(button.querySelector("svg")?.innerHTML).toBe(reference);
});
