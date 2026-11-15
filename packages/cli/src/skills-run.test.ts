import assert from "node:assert/strict";
import { test } from "node:test";

import type { GolemClient } from "@golem/client";

import { parseSkillsNew, runSkillsEdit, runSkillsNew, type SkillsDeps } from "./skills-run.ts";

function setup(overrides: Partial<SkillsDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  const checked: string[] = [];
  const deps: SkillsDeps = {
    cwd: "/work/proj",
    editFile: async (path) => {
      opened.push(path);
      return true;
    },
    check: async (path) => {
      checked.push(path);
      return 0;
    },
    write: (line) => out.push(line),
    error: (line) => err.push(line),
    ...overrides,
  };
  return { deps, out, err, opened, checked };
}

test("new parses its name and flags", () => {
  assert.deepEqual(parseSkillsNew(["a"]), { name: "a", project: false, description: null });
  assert.deepEqual(parseSkillsNew(["--project", "a", "--description", "does x"]), {
    name: "a",
    project: true,
    description: "does x",
  });
  assert.equal(parseSkillsNew([]), null);
  assert.equal(parseSkillsNew(["a", "b"]), null);
  assert.equal(parseSkillsNew(["a", "--description"]), null);
  assert.equal(parseSkillsNew(["a", "--nope"]), null);
});

test("new calls skill.create with the user scope, then opens and checks the file", async () => {
  const calls: unknown[] = [];
  const client = {
    createSkill: async (params: unknown, options: unknown) => {
      calls.push([params, options]);
      return { path: "/home/.golem/skills/a/SKILL.md", mtime_ns: 1 };
    },
  } as unknown as GolemClient;
  const t = setup();
  assert.equal(await runSkillsNew(client, { name: "a", project: false, description: "does x" }, t.deps), 0);
  assert.deepEqual(calls, [[{ name: "a", scope: "user", cwd: "/work/proj", description: "does x" }, { local: true }]]);
  assert.deepEqual(t.opened, ["/home/.golem/skills/a/SKILL.md"]);
  assert.deepEqual(t.checked, ["/home/.golem/skills/a/SKILL.md"]);
});

test("new --project uses the project scope", async () => {
  const calls: { scope?: string; description?: string }[] = [];
  const client = {
    createSkill: async (params: { scope: string; description: string }) => {
      calls.push(params);
      return { path: "/work/proj/.agents/skills/a/SKILL.md", mtime_ns: 1 };
    },
  } as unknown as GolemClient;
  const t = setup();
  assert.equal(await runSkillsNew(client, { name: "a", project: true, description: null }, t.deps), 0);
  assert.equal(calls[0]?.scope, "project");
  assert.match(calls[0]?.description ?? "", /TODO/);
});

test("new with a taken name prints the error, exits 1 and opens nothing", async () => {
  const client = {
    createSkill: async () => {
      throw new Error("a skill called a already exists");
    },
  } as unknown as GolemClient;
  const t = setup();
  assert.equal(await runSkillsNew(client, { name: "a", project: false, description: null }, t.deps), 1);
  assert.deepEqual(t.err, ["a skill called a already exists"]);
  assert.deepEqual(t.opened, []);
});

test("edit opens the skill's path in the editor and returns the check's code", async () => {
  const client = {
    readSkill: async (name: string, cwd: string) => {
      assert.deepEqual([name, cwd], ["a", "/work/proj"]);
      return { path: "/p/a/SKILL.md", text: "", mtime_ns: 1, source: "user" };
    },
  } as unknown as GolemClient;
  const t = setup({
    check: async (path) => {
      t.out.push(`${path}:3: bad`);
      return 1;
    },
  });
  assert.equal(await runSkillsEdit(client, "a", t.deps), 1);
  assert.deepEqual(t.opened, ["/p/a/SKILL.md"]);
  assert.deepEqual(t.out, ["/p/a/SKILL.md:3: bad"]);
});

test("edit refuses a bundled skill and opens nothing", async () => {
  const client = {
    readSkill: async () => ({ path: "/golem/skills/a/SKILL.md", text: "", mtime_ns: 1, source: "bundled" }),
  } as unknown as GolemClient;
  const t = setup();
  assert.equal(await runSkillsEdit(client, "a", t.deps), 1);
  assert.deepEqual(t.opened, []);
  assert.match(t.err[0] ?? "", /bundled with golem and read-only/);
});

test("edit says so when the editor fails, and when the skill is missing", async () => {
  const client = {
    readSkill: async (name: string) => {
      if (name === "gone") throw new Error("no skill called gone");
      return { path: "/p/a/SKILL.md", text: "", mtime_ns: 1, source: "user" };
    },
  } as unknown as GolemClient;
  const failing = setup({ editFile: async () => false });
  assert.equal(await runSkillsEdit(client, "a", failing.deps), 1);
  assert.deepEqual(failing.checked, []);
  assert.match(failing.err[0] ?? "", /editor did not finish/);
  const missing = setup();
  assert.equal(await runSkillsEdit(client, "gone", missing.deps), 1);
  assert.deepEqual(missing.err, ["no skill called gone"]);
  assert.deepEqual(missing.opened, []);
});
