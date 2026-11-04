import { COMMANDS } from "@golem/view";
import { expect, test } from "vitest";
import { needsArgs } from "./needs-args.ts";

test("no arguments, or only optional ones, need nothing", () => {
  expect(needsArgs("")).toBe(false);
  expect(needsArgs("[id]")).toBe(false);
  expect(needsArgs("[code]")).toBe(false);
  expect(needsArgs("[pull|rm] [name]")).toBe(false);
  expect(needsArgs("[enable|disable <name>]")).toBe(false);
  expect(needsArgs("[wire|model|hold|go]")).toBe(false);
});

test("a required argument is one outside the brackets", () => {
  expect(needsArgs("<provider>")).toBe(true);
  expect(needsArgs("run|pin|unpin <name>")).toBe(true);
  expect(needsArgs("[a] <b>")).toBe(true);
});

test("of the commands, only /logout and /skill need arguments", () => {
  expect(COMMANDS.filter((command) => needsArgs(command.args)).map((command) => command.name)).toEqual(["/logout", "/skill"]);
});
