import assert from "node:assert/strict";
import { test } from "node:test";

import {
  choiceForKey,
  type Gate,
  gateService,
  LATER,
  NO_ANSWER,
  QUESTION,
  SESSION_NO_ANSWER,
  SESSION_STARTED,
  type ServiceChoice,
  sessionFailure,
  STARTED,
} from "./service-gate.ts";

type Fake = Gate & { calls: string[]; output: string[] };

function fake(options: {
  answers?: boolean;
  installed?: boolean;
  interactive?: boolean;
  choice?: ServiceChoice;
  installs?: boolean;
  serves?: boolean;
  comesUp?: boolean;
}): Fake {
  const calls: string[] = [];
  const output: string[] = [];
  return {
    calls,
    output,
    answers: async () => options.answers ?? false,
    installed: () => options.installed ?? false,
    interactive: options.interactive ?? true,
    ask: async (question) => {
      calls.push("ask");
      assert.equal(question, QUESTION);
      return options.choice ?? "install";
    },
    install: async () => {
      calls.push("install");
      return options.installs ?? true;
    },
    serve: () => {
      calls.push("serve");
      return (options.serves ?? true)
        ? { stop: () => calls.push("stop"), output: () => "Traceback\nDatabaseTooNewError\n", exited: () => true }
        : null;
    },
    waitUntilAnswers: async (giveUp) => {
      calls.push(giveUp() ? "wait until it exits" : "wait");
      return options.comesUp ?? true;
    },
    write: (text) => output.push(text),
  };
}

test("a daemon that answers opens the chat with no question", async () => {
  const gate = fake({ answers: true });
  assert.deepEqual(await gateService(gate), { kind: "open", session: null });
  assert.deepEqual(gate.calls, []);
});

test("an existing launch agent is launchd's to start, so nothing is asked", async () => {
  const gate = fake({ installed: true });
  assert.deepEqual(await gateService(gate), { kind: "open", session: null });
  assert.deepEqual(gate.calls, []);
});

test("with no terminal nothing is asked and nothing is installed", async () => {
  const gate = fake({ interactive: false });
  assert.deepEqual(await gateService(gate), { kind: "open", session: null });
  assert.deepEqual(gate.calls, []);
});

test("yes installs the launch agent, waits for it, and opens the chat", async () => {
  const gate = fake({ choice: "install" });
  assert.deepEqual(await gateService(gate), { kind: "open", session: null });
  assert.deepEqual(gate.calls, ["ask", "install", "wait"]);
  assert.deepEqual(gate.output, [STARTED]);
});

test("a failed install exits non-zero, and its own error is all that is printed", async () => {
  const gate = fake({ choice: "install", installs: false });
  assert.deepEqual(await gateService(gate), { kind: "exit", code: 1 });
  assert.deepEqual(gate.calls, ["ask", "install"]);
  assert.deepEqual(gate.output, []);
});

test("an installed daemon that never answers points at the logs", async () => {
  const gate = fake({ choice: "install", comesUp: false });
  assert.deepEqual(await gateService(gate), { kind: "exit", code: 1 });
  assert.deepEqual(gate.output, [NO_ANSWER]);
});

test("n starts a daemon for this window and hands it back to be stopped", async () => {
  const gate = fake({ choice: "session" });
  const result = await gateService(gate);
  assert.equal(result.kind, "open");
  assert.ok(result.kind === "open" && result.session !== null);
  assert.deepEqual(gate.calls, ["ask", "serve", "wait until it exits"]);
  assert.deepEqual(gate.output, [SESSION_STARTED]);
  result.session.stop();
  assert.deepEqual(gate.calls.at(-1), "stop");
});

test("a window daemon that never answers is stopped before exiting", async () => {
  const gate = fake({ choice: "session", comesUp: false });
  assert.deepEqual(await gateService(gate), { kind: "exit", code: 1 });
  assert.deepEqual(gate.calls, ["ask", "serve", "wait until it exits", "stop"]);
  assert.deepEqual(gate.output, [`Traceback\nDatabaseTooNewError\n${SESSION_NO_ANSWER}`]);
});

test("a window daemon's failure shows only the last ten lines it wrote", () => {
  const lines = Array.from({ length: 15 }, (_, index) => `line ${index}`).join("\n");
  assert.equal(sessionFailure(lines), `${lines.split("\n").slice(5).join("\n")}\n${SESSION_NO_ANSWER}`);
  assert.equal(sessionFailure("  \n"), SESSION_NO_ANSWER);
});

test("a window daemon that could not start exits non-zero", async () => {
  const gate = fake({ choice: "session", serves: false });
  assert.deepEqual(await gateService(gate), { kind: "exit", code: 1 });
  assert.deepEqual(gate.calls, ["ask", "serve"]);
});

test("q quits cleanly and says how to start the service later", async () => {
  const gate = fake({ choice: "quit" });
  assert.deepEqual(await gateService(gate), { kind: "exit", code: 0 });
  assert.deepEqual(gate.calls, ["ask"]);
  assert.deepEqual(gate.output, [LATER]);
});

test("Enter and y mean yes, n means this window, q, Esc, and Ctrl-C quit", () => {
  for (const key of ["\r", "\n", "y", "Y"]) {
    assert.equal(choiceForKey(key), "install");
  }
  for (const key of ["n", "N"]) {
    assert.equal(choiceForKey(key), "session");
  }
  for (const key of ["q", "Q", "\u001b", "\u0003", "\u0004"]) {
    assert.equal(choiceForKey(key), "quit");
  }
  for (const key of ["x", " ", "1"]) {
    assert.equal(choiceForKey(key), null);
  }
});
