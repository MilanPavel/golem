import { COMMANDS } from "@golem/view";
import { expect, test } from "vitest";
import { paletteRows } from "./rows.ts";

const names = (query: string) =>
  paletteRows(COMMANDS, query).map((row) => (row.kind === "command" ? row.command.name : row.kind === "page" ? row.name : row.text));

test("all commands, grouped as Session, Model, Tools, and View, each group in the table's order", () => {
  const rows = paletteRows(COMMANDS, "");
  const groups = rows.map((row) => row.group).filter((group, at, all) => all.indexOf(group) === at);
  expect(groups).toEqual(["Session", "Model", "Tools", "View"]);
  // Items of a group are next to each other.
  expect(rows.map((row) => row.group).join(",")).toBe([...rows.map((row) => row.group)].sort((a, b) => groups.indexOf(a) - groups.indexOf(b)).join(","));
  expect(rows.filter((row) => row.kind === "command")).toHaveLength(COMMANDS.length);
  expect(names("").at(-1)).toBe("Keys");
});

test("typing filters on name, args, and description, ignoring case", () => {
  expect(names("TIME")).toContain("/time");
  expect(names("pager")).toEqual(["/artifact"]);
  expect(names("provider")).toEqual(expect.arrayContaining(["/login", "/logout"]));
  expect(names("/mo")).toEqual(["/model"]);
});

test("names that start with the query come first, with or without the slash", () => {
  expect(names("mo")[0]).toBe("/model");
  expect(names("/mo")[0]).toBe("/model");
  const found = paletteRows(COMMANDS, "se").map((row) => (row.kind === "command" ? row.command.name : ""));
  expect(found.indexOf("/sessions")).toBeLessThan(found.indexOf("/close"));
});

test("only /help has a key, and Keys is a page row in View with ? as its key", () => {
  const rows = paletteRows(COMMANDS, "");
  expect(rows.flatMap((row) => (row.kind !== "message" && row.key !== null ? [row.id] : []))).toEqual(["/help", "page:keys"]);
  const keys = rows.find((row) => row.id === "page:keys");
  expect(keys).toMatchObject({ kind: "page", group: "View", key: "?" });
});

test("text that fits nothing is one Message row, also when it starts with a slash", () => {
  expect(paletteRows(COMMANDS, "  hello there ")).toEqual([{ id: "message", group: "Message", kind: "message", text: "hello there" }]);
  expect(paletteRows(COMMANDS, "/nope")).toMatchObject([{ kind: "message", text: "/nope" }]);
});
