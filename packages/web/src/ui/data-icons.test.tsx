import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { DataSourceIcon } from "./data-icons.tsx";

function drawing(kind: Parameters<typeof DataSourceIcon>[0]["kind"], location: string): string {
  const { container, unmount } = render(<DataSourceIcon kind={kind} location={location} />);
  const svg = container.querySelector("svg");
  expect(svg?.getAttribute("aria-hidden")).toBe("true");
  const markup = svg?.innerHTML ?? "";
  unmount();
  return markup;
}

test("each kind of source, and each type of file, has its own drawing", () => {
  const drawings = [
    drawing("builtin", "~/.golem/golem.db"),
    drawing("files", "bank/*.csv"),
    drawing("files", "a.xlsx"),
    drawing("files", "a.parquet"),
    drawing("files", "a.jsonl"),
    drawing("files", "logs/"),
    drawing("files", "a.bin"),
    drawing("sqlite", "a.db"),
    drawing("postgres", "postgres://h/db"),
    drawing("url", "https://example.com/a.csv"),
  ];
  expect(new Set(drawings).size).toBe(drawings.length);
  expect(drawing("duckdb", "a.duckdb")).not.toBe(drawing("sqlite", "a.db"));
  expect(drawing("mysql", "mysql://h/db")).not.toBe(drawing("postgres", "postgres://h/db"));
  expect(drawing("files", "a.tsv")).toBe(drawing("files", "bank/*.csv"));
});
