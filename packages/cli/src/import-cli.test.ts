import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpImportScanResult } from "../../protocol/gen/mcp-import-scan-result.ts";

import { allNew, formatScan, isImportSource, missingRefs, numbered, parsePicks, targetOf } from "./import-cli.ts";

const SCAN: McpImportScanResult = {
  scan_id: "s",
  sources: [
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      path: "/h/claude.json",
      candidates: [
        { key: "a", name: "github", original_name: "github", scope: "user", config: { command: "npx", args: ["-y", "x"] }, warnings: [], clash: false, already_same: false },
        { key: "b", name: "docs-2", original_name: "docs", scope: "user", config: { url: "https://d.test/mcp" }, warnings: ["old SSE"], clash: true, already_same: true },
      ],
      skipped: ["broken: neither a command nor a url"],
    },
    {
      id: "vscode",
      label: "VS Code",
      candidates: [
        { key: "c", name: "tool", original_name: "tool", scope: "project", config: { command: "uvx" }, missing_refs: ["mcp/tool"], warnings: [], clash: false, already_same: false },
      ],
      error: "could not read it",
    },
  ] as McpImportScanResult["sources"],
};

test("candidates are numbered across sources, and what is already added is marked", () => {
  const items = numbered(SCAN.sources);
  assert.deepEqual(items.map((item) => [item.n, item.candidate.key]), [[1, "a"], [2, "b"], [3, "c"]]);
  const text = formatScan(SCAN.sources);
  assert.match(text, /^Claude Desktop \(\/h\/claude.json\)$/m);
  assert.match(text, / 1 {2}github {2}npx -y x$/m);
  assert.match(text, / 2 {2}docs {2}https:\/\/d.test\/mcp {2}\(already added\)/);
  assert.match(text, /! old SSE/);
  assert.match(text, /skipped broken: neither a command nor a url/);
  assert.match(text, /3 {2}tool {2}uvx {2}\(this project\)/);
  assert.match(text, /could not read it/);
  assert.equal(targetOf(SCAN.sources[0]?.candidates?.[1] as never), "https://d.test/mcp");
});

test("picks are numbers, with a new name after =, or a for the new ones", () => {
  const items = numbered(SCAN.sources);
  assert.deepEqual(parsePicks("1 3=mine", items), {
    ok: true,
    picks: [
      { key: "a", name: "github", scope: "user" },
      { key: "c", name: "mine", scope: "project" },
    ],
  });
  assert.deepEqual(parsePicks("a", items), {
    ok: true,
    picks: [
      { key: "a", name: "github", scope: "user" },
      { key: "c", name: "tool", scope: "project" },
    ],
  });
  assert.deepEqual(parsePicks("", items), { ok: true, picks: [] });
  assert.deepEqual(parsePicks("1,1", items), { ok: true, picks: [{ key: "a", name: "github", scope: "user" }] });
  assert.equal(allNew(items).length, 2);
});

test("a number outside the list, a bad name, and two servers with one name are refused", () => {
  const items = numbered(SCAN.sources);
  assert.deepEqual(parsePicks("9", items), { ok: false, message: "9 is not a number in the list" });
  assert.deepEqual(parsePicks("x", items), { ok: false, message: "x is not a number in the list" });
  assert.match((parsePicks("1=bad_name", items) as { message: string }).message, /not a server name/);
  assert.match((parsePicks("1=same 3=same", items) as { message: string }).message, /two servers would be named same/);
});

test("the values to ask for are the missing references of what was picked, once each", () => {
  const items = numbered(SCAN.sources);
  assert.deepEqual(missingRefs(items, ["a", "c"]), ["mcp/tool"]);
  assert.deepEqual(missingRefs(items, ["a"]), []);
});

test("--from knows the five apps, and anything else is a file", () => {
  assert.ok(isImportSource("cursor"));
  assert.ok(!isImportSource("./servers.json"));
});
