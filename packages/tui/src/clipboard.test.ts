import assert from "node:assert/strict";
import { test } from "node:test";

import { clipboardCommand, copiedHint, copyText, osc52, overSsh, type ClipboardCommand } from "./clipboard.ts";

const PBCOPY: ClipboardCommand = { command: "/usr/bin/pbcopy", args: [] };

test("a Mac with pbcopy uses it, and other systems have no command yet", () => {
  assert.deepEqual(clipboardCommand("darwin", (file) => file === "/usr/bin/pbcopy"), PBCOPY);
  assert.equal(clipboardCommand("darwin", () => false), null);
  assert.equal(clipboardCommand("linux", () => true), null);
});

test("SSH is seen from either variable", () => {
  assert.equal(overSsh({ SSH_TTY: "/dev/ttys001" }), true);
  assert.equal(overSsh({ SSH_CONNECTION: "10.0.0.1 22 10.0.0.2 22" }), true);
  assert.equal(overSsh({ SSH_TTY: "" }), false);
  assert.equal(overSsh({}), false);
});

test("OSC 52 carries the text as base64, unicode included", () => {
  assert.equal(osc52("hi"), "\u001b]52;c;aGk=\u0007");
  assert.equal(osc52("❯ ok"), `\u001b]52;c;${Buffer.from("❯ ok").toString("base64")}\u0007`);
});

test("the command copies when it is there and works", async () => {
  const ran: string[] = [];
  const written: string[] = [];
  const way = await copyText("hello", {
    env: {},
    command: PBCOPY,
    run: async (_command, text) => {
      ran.push(text);
    },
    write: (data) => written.push(data),
  });
  assert.equal(way, "command");
  assert.deepEqual(ran, ["hello"]);
  assert.deepEqual(written, []);
});

test("over SSH, without a command, or when it fails, the terminal is asked instead", async () => {
  const cases = [
    { env: { SSH_TTY: "/dev/ttys001" }, command: PBCOPY },
    { env: {}, command: null },
  ];
  for (const { env, command } of cases) {
    const written: string[] = [];
    const way = await copyText("hi", {
      env,
      command,
      run: async () => assert.fail("pbcopy must not run"),
      write: (data) => written.push(data),
    });
    assert.equal(way, "osc52");
    assert.deepEqual(written, [osc52("hi")]);
  }
  const written: string[] = [];
  const way = await copyText("hi", {
    env: {},
    command: PBCOPY,
    run: async () => {
      throw new Error("pbcopy exited with code 1");
    },
    write: (data) => written.push(data),
  });
  assert.equal(way, "osc52");
  assert.deepEqual(written, [osc52("hi")]);
});

test("the hint says what happened, counting characters, not bytes", () => {
  assert.equal(copiedHint("command", "héllo ❯"), "copied 7 chars to clipboard");
  assert.equal(copiedHint("command", "a"), "copied 1 char to clipboard");
  assert.equal(copiedHint("osc52", "abc"), "asked the terminal to copy 3 chars");
});
