import assert from "node:assert/strict";
import { test } from "node:test";

import { editConfig, formatEditError, mcpRegion, type EditIo, type RawApi, WHOLE_FILE } from "./config-edit.ts";

const FILE = [
  "log_level = 'INFO'",
  "",
  "[mcp.git]",
  'command = "uvx"',
  "[mcp.git.env]",
  'A = "b"',
  "",
  "[mcp.github]",
  'url = "https://x.test/mcp"',
  "",
  "[[rule]]",
  "x = 1",
  "",
].join("\n");

test("a server's region is its table and the tables under it, and not a server whose name starts the same", () => {
  const region = mcpRegion("git");
  const found = region.extract(FILE);
  assert.deepEqual(found, { text: '[mcp.git]\ncommand = "uvx"\n[mcp.git.env]\nA = "b"\n', start: 2 });
  assert.equal(mcpRegion("nope").extract(FILE), null);
  assert.equal(mcpRegion("github").extract(FILE)?.text, '[mcp.github]\nurl = "https://x.test/mcp"\n');
  assert.equal(mcpRegion("git").extract('[ mcp . "git" ]\nx = 1\n')?.start, 0);
});

test("splicing puts the edited text where the region was and leaves the rest alone", () => {
  const out = mcpRegion("git").splice(FILE, '[mcp.git]\ncommand = "other"\ntimeout_seconds = 5\n');
  assert.equal(
    out,
    [
      "log_level = 'INFO'",
      "",
      "[mcp.git]",
      'command = "other"',
      "timeout_seconds = 5",
      "",
      "[mcp.github]",
      'url = "https://x.test/mcp"',
      "",
      "[[rule]]",
      "x = 1",
      "",
    ].join("\n"),
  );
  assert.equal(mcpRegion("zzz").splice(FILE, "x"), FILE);
});

test("an error line is shown in the text that was edited, or as a file line when it is outside", () => {
  assert.equal(formatEditError({ line: 5, message: "bad", path: "mcp.git.env" }, 2, "a\nb\nc\nd\n"), "line 3: bad (mcp.git.env)");
  assert.equal(formatEditError({ line: 1, message: "nope" }, 2, "a\nb\n"), "file line 1: nope");
  assert.equal(formatEditError({ message: "changed" }, 0, "a"), "changed");
});

function harness(options: {
  edits: (string | null)[];
  sets: { ok: boolean; errors?: { line?: number; message: string }[]; restart_needed?: string[] }[];
  keys?: string[];
  files?: { text: string; mtime_ns: number }[];
}) {
  const written: string[] = [];
  const sent: { text: string; base: number | null }[] = [];
  const asked: string[] = [];
  const shown: string[] = [];
  let restarted = 0;
  let reads = 0;
  const files = options.files ?? [{ text: FILE, mtime_ns: 7 }];
  const api: RawApi = {
    get: async () => ({ path: "/h/config.toml", ...(files[Math.min(reads++, files.length - 1)] as { text: string; mtime_ns: number }) }),
    set: async (text, base) => {
      sent.push({ text, base });
      const next = options.sets.shift();
      assert.ok(next, "an unexpected save");
      return next;
    },
  };
  const io: EditIo = {
    edit: async (text) => {
      shown.push(text);
      const next = options.edits.shift();
      assert.notEqual(next, undefined, "an unexpected edit");
      return next ?? null;
    },
    key: async (question, keys) => {
      asked.push(question);
      const key = options.keys?.shift();
      assert.ok(key !== undefined && keys.includes(key), `an unexpected question: ${question}`);
      return key;
    },
    write: (line) => written.push(line),
    restart: async () => {
      restarted += 1;
    },
  };
  return { api, io, written, sent, asked, shown, restarted: () => restarted };
}

test("a valid edit is saved against the mtime it was read at", async () => {
  const run = harness({ edits: ['[mcp.git]\ncommand = "x"\n[mcp.git.env]\nA = "b"\n'], sets: [{ ok: true }] });
  assert.equal(await editConfig(run.api, mcpRegion("git"), run.io), 0);
  assert.equal(run.sent[0]?.base, 7);
  assert.match(run.sent[0]?.text ?? "", /command = "x"/);
  assert.deepEqual(run.written, ["saved /h/config.toml"]);
});

test("no change is not saved, and a missing region is said", async () => {
  const same = harness({ edits: ['[mcp.git]\ncommand = "uvx"\n[mcp.git.env]\nA = "b"'], sets: [] });
  assert.equal(await editConfig(same.api, mcpRegion("git"), same.io), 0);
  assert.deepEqual(same.written, ["no changes"]);
  const none = harness({ edits: [], sets: [] });
  assert.equal(await editConfig(none.api, mcpRegion("nope"), none.io), 1);
  assert.match(none.written[0] ?? "", /has no \[mcp.nope\]/);
  const failed = harness({ edits: [null], sets: [] });
  assert.equal(await editConfig(failed.api, WHOLE_FILE, failed.io), 1);
  assert.match(failed.written[0] ?? "", /did not finish/);
});

test("an error shows its line, and Edit again reopens the editor on the person's own text", async () => {
  const run = harness({
    edits: ['[mcp.git]\ncommand = \n', '[mcp.git]\ncommand = "ok"\n'],
    sets: [{ ok: false, errors: [{ line: 4, message: "invalid TOML" }] }, { ok: true }],
    keys: ["e"],
  });
  assert.equal(await editConfig(run.api, mcpRegion("git"), run.io), 0);
  assert.equal(run.written[0], "line 2: invalid TOML");
  assert.equal(run.shown[1], '[mcp.git]\ncommand = \n');
  assert.deepEqual(run.sent.map((each) => each.base), [7, 7]);
});

test("Discard leaves the file as it was, and no save is tried again", async () => {
  const run = harness({
    edits: ["[mcp.git]\nbad\n"],
    sets: [{ ok: false, errors: [{ line: 3, message: "invalid TOML" }] }],
    keys: ["d"],
  });
  assert.equal(await editConfig(run.api, mcpRegion("git"), run.io), 1);
  assert.equal(run.written.at(-1), "discarded: the file is as it was");
  assert.equal(run.sent.length, 1);
});

test("a conflict offers a reload, which reads the file again at its new mtime", async () => {
  const changed = FILE.replace('"uvx"', '"uvx2"');
  const run = harness({
    edits: ['[mcp.git]\ncommand = "mine"\n', '[mcp.git]\ncommand = "again"\n'],
    sets: [{ ok: false, errors: [{ message: "config.toml changed on disk; reload" }] }, { ok: true }],
    keys: ["r"],
    files: [
      { text: FILE, mtime_ns: 7 },
      { text: changed, mtime_ns: 9 },
    ],
  });
  assert.equal(await editConfig(run.api, mcpRegion("git"), run.io), 0);
  assert.match(run.asked[0] ?? "", /\[r\]eload/);
  assert.match(run.shown[1] ?? "", /uvx2/);
  assert.deepEqual(run.sent.map((each) => each.base), [7, 9]);
});

test("a setting read only at start offers a restart", async () => {
  const yes = harness({ edits: ["log_level = 'DEBUG'\n"], sets: [{ ok: true, restart_needed: ["log_level"] }], keys: ["y"] });
  assert.equal(await editConfig(yes.api, WHOLE_FILE, yes.io), 0);
  assert.match(yes.written[1] ?? "", /read only when the daemon starts: log_level/);
  assert.equal(yes.restarted(), 1);
  const no = harness({ edits: ["log_level = 'DEBUG'\n"], sets: [{ ok: true, restart_needed: ["log_level"] }], keys: ["n"] });
  assert.equal(await editConfig(no.api, WHOLE_FILE, no.io), 0);
  assert.equal(no.restarted(), 0);
});
