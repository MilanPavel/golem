import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListedSkill } from "@golem/client";

import {
  applyComposer,
  closedDebug,
  COMMANDS,
  helpLines,
  invocableSkills,
  pinnableSkills,
  toggleDebugTab,
  type DebugState,
  type SkillChoice,
} from "./commands.ts";

test("a sentence is sent and a slash command is not", () => {
  const sentence = applyComposer(closedDebug, "hello");
  assert.equal(sentence.kind, "send");
  if (sentence.kind === "send") {
    assert.equal(sentence.text, "hello");
  }

  const debug = applyComposer(closedDebug, "/debug");
  assert.equal(debug.kind, "local");
  if (debug.kind === "local") {
    assert.equal(debug.debug.open, true);
    assert.equal(debug.debug.tab, "wire");
  }

  const model = applyComposer(closedDebug, "/debug model");
  assert.equal(model.kind, "local");
  if (model.kind === "local") {
    assert.equal(model.debug.open, true);
    assert.equal(model.debug.tab, "model");
    assert.equal(model.refreshModel, true);
  }

  const wire = applyComposer(model.kind === "local" ? model.debug : closedDebug, "/debug wire");
  assert.equal(wire.kind, "local");
  if (wire.kind === "local") {
    assert.equal(wire.debug.tab, "wire");
  }
});

test("a doubled slash sends the rest as a normal message", () => {
  const outcome = applyComposer(closedDebug, "//hello");
  assert.equal(outcome.kind, "send");
  if (outcome.kind === "send") {
    assert.equal(outcome.text, "hello");
  }
});

test("an unknown slash command stays out of the model", () => {
  const outcome = applyComposer(closedDebug, "/foo");
  assert.deepEqual(outcome, { kind: "unknown", notice: "unknown command \u2014 /help lists them" });
  assert.equal(applyComposer(closedDebug, "/debug extra").kind, "unknown");
});

test("tab switches wire and model while the panel is open", () => {
  const open = { ...closedDebug, open: true, tab: "wire" as const };
  const model = toggleDebugTab(open);
  assert.equal(model.tab, "model");
  assert.equal(toggleDebugTab(model).tab, "wire");
  assert.equal(toggleDebugTab(closedDebug), closedDebug);
});

test("/debug toggles the panel", () => {
  const opened = applyComposer(closedDebug, "/debug");
  assert.equal(opened.kind, "local");
  if (opened.kind !== "local") {
    return;
  }
  const closed = applyComposer(opened.debug, "/debug");
  assert.equal(closed.kind, "local");
  if (closed.kind === "local") {
    assert.equal(closed.debug.open, false);
  }
});

test("hold shows the line and go is what sends it", () => {
  const armed = applyComposer(closedDebug, "/debug hold");
  assert.equal(armed.kind, "local");
  if (armed.kind !== "local") {
    return;
  }
  assert.equal(armed.debug.hold, true);

  const preview = applyComposer(armed.debug, "hello");
  assert.equal(preview.kind, "local");
  if (preview.kind !== "local") {
    return;
  }
  assert.equal(preview.debug.held, "hello");
  assert.equal(preview.debug.tab, "model");

  const sent = applyComposer(preview.debug, "/debug go");
  assert.equal(sent.kind, "send");
  if (sent.kind === "send") {
    assert.equal(sent.text, "hello");
    assert.equal(sent.debug.hold, false);
    assert.equal(sent.debug.held, null);
  }
});

test("go with nothing held does not send", () => {
  const outcome = applyComposer(closedDebug, "/debug go");
  assert.equal(outcome.kind, "local");
  if (outcome.kind === "local") {
    assert.equal(outcome.notice, "nothing held");
  }
});

test("hold again puts the unsent line back", () => {
  const held: DebugState = { open: true, tab: "model", hold: true, held: "hello" };
  const outcome = applyComposer(held, "/debug hold");
  assert.equal(outcome.kind, "local");
  if (outcome.kind === "local") {
    assert.equal(outcome.debug.hold, false);
    assert.equal(outcome.debug.held, null);
    assert.equal(outcome.restore, "hello");
  }
});

test("/sessions and /new are commands without arguments", () => {
  assert.deepEqual(applyComposer(closedDebug, "/sessions"), { kind: "sessions" });
  assert.deepEqual(applyComposer(closedDebug, "/skills"), { kind: "skills" });
  assert.deepEqual(applyComposer(closedDebug, " /new "), { kind: "new" });
  assert.equal(applyComposer(closedDebug, "/new now").kind, "unknown");
  assert.equal(applyComposer(closedDebug, "/session").kind, "unknown");
});

test("/model opens the picker or names one model", () => {
  assert.deepEqual(applyComposer(closedDebug, "/model"), { kind: "model", name: null });
  assert.deepEqual(applyComposer(closedDebug, "/model  sonnet "), { kind: "model", name: "sonnet" });
  assert.deepEqual(applyComposer(closedDebug, "/model openrouter/qwen/qwen3"), {
    kind: "model",
    name: "openrouter/qwen/qwen3",
  });
  assert.equal(applyComposer(closedDebug, "/model a b").kind, "unknown");
  assert.deepEqual(applyComposer(closedDebug, "/model pull qwen3:8b"), { kind: "model-pull", name: "qwen3:8b" });
  assert.deepEqual(applyComposer(closedDebug, "/model rm ollama/qwen3:8b"), { kind: "model-rm", name: "ollama/qwen3:8b" });
  assert.equal(applyComposer(closedDebug, "/model pull").kind, "model");
});

test("/login and /logout take exactly one provider, and the key never goes in the command", () => {
  assert.deepEqual(applyComposer(closedDebug, "/login anthropic"), { kind: "login", provider: "anthropic" });
  assert.deepEqual(applyComposer(closedDebug, "/logout openai"), { kind: "logout", provider: "openai" });
  assert.equal(applyComposer(closedDebug, "/login").kind, "unknown");
  assert.equal(applyComposer(closedDebug, "/login anthropic sk-abc").kind, "unknown");
});

test("/title takes the rest of the line as the name, or nothing to show it", () => {
  assert.deepEqual(applyComposer(closedDebug, "/title  Trip   plans "), { kind: "title", title: "Trip plans" });
  assert.deepEqual(applyComposer(closedDebug, "/title"), { kind: "title", title: null });
});

test("/help lists nothing of its own, and every command has a description", () => {
  assert.equal(COMMANDS.length > 0, true);
  for (const command of COMMANDS) {
    assert.equal(command.description.trim().length > 0, true);
  }
  const lines = helpLines(COMMANDS, 120);
  assert.equal(lines.length, COMMANDS.length);
  for (const command of COMMANDS) {
    assert.equal(
      lines.some((line) => line.startsWith(command.name) && line.includes(command.description)),
      true,
    );
  }
  assert.deepEqual(helpLines([{ name: "/only", args: "", description: "Just this" }], 80), ["/only  Just this"]);
  assert.equal(helpLines([{ name: "/only", args: "[a|b]", description: "Picks" }], 80)[0]?.startsWith("/only [a|b]"), true);

  assert.deepEqual(applyComposer(closedDebug, "/help"), { kind: "help" });
  assert.equal(applyComposer(closedDebug, "/help more").kind, "unknown");
  const debug = COMMANDS.find((command) => command.name === "/debug");
  assert.deepEqual(debug?.choices, ["wire", "model", "hold", "go"]);
});

test("/copy, /export, and /time stay on this machine", () => {
  assert.deepEqual(applyComposer(closedDebug, "/copy"), { kind: "copy", code: false });
  assert.deepEqual(applyComposer(closedDebug, "/copy code"), { kind: "copy", code: true });
  assert.equal(applyComposer(closedDebug, "/copy else").kind, "unknown");
  assert.deepEqual(applyComposer(closedDebug, "/export"), { kind: "export", path: null });
  assert.deepEqual(applyComposer(closedDebug, "/export  ~/out/chat.md"), { kind: "export", path: "~/out/chat.md" });
  assert.deepEqual(applyComposer(closedDebug, "/time"), { kind: "time" });
  assert.equal(applyComposer(closedDebug, "/time on").kind, "unknown");
});

test("/close takes no arguments", () => {
  assert.deepEqual(applyComposer(closedDebug, "/close"), { kind: "close-session" });
  assert.equal(applyComposer(closedDebug, "/close now").kind, "unknown");
});

test("/fork takes no arguments", () => {
  assert.deepEqual(applyComposer(closedDebug, "/fork"), { kind: "fork" });
  assert.equal(applyComposer(closedDebug, "/fork here").kind, "unknown");
});

test("/todos toggles the todo list and /artifact takes an optional id", () => {
  assert.deepEqual(applyComposer(closedDebug, "/todos"), { kind: "todos" });
  assert.deepEqual(applyComposer(closedDebug, "/artifact"), { kind: "artifact", id: null });
  assert.deepEqual(applyComposer(closedDebug, "/artifact a_1"), { kind: "artifact", id: "a_1" });
  assert.equal(applyComposer(closedDebug, "/artifact a b").kind, "unknown");
});

test("/mcp shows the servers, and enable or disable takes one name", () => {
  assert.deepEqual(applyComposer(closedDebug, "/mcp"), { kind: "mcp" });
  assert.deepEqual(applyComposer(closedDebug, "/mcp enable git"), { kind: "mcp-toggle", on: true, name: "git" });
  assert.deepEqual(applyComposer(closedDebug, "/mcp disable git"), { kind: "mcp-toggle", on: false, name: "git" });
  for (const wrong of ["/mcp enable", "/mcp restart git", "/mcp enable a b"]) {
    assert.deepEqual(applyComposer(closedDebug, wrong), {
      kind: "unknown",
      notice: "/mcp, /mcp enable <name>, or /mcp disable <name>",
    });
  }
});

const SKILLS: readonly SkillChoice[] = [
  { name: "ship", description: "Open a pull request.", argumentHint: "[hint]" },
  { name: "help", description: "A skill named like a command.", argumentHint: null },
];

test("/name runs a skill with the rest of the line as its arguments, spacing and quotes kept", () => {
  const outcome = applyComposer(closedDebug, '/ship fix the  "mcp restart"', SKILLS);
  assert.deepEqual(outcome, {
    kind: "skill",
    name: "ship",
    args: 'fix the  "mcp restart"',
    text: '/ship fix the  "mcp restart"',
    debug: closedDebug,
  });

  const bare = applyComposer(closedDebug, "/ship", SKILLS);
  assert.equal(bare.kind, "skill");
  if (bare.kind === "skill") {
    assert.equal(bare.args, "");
  }
});

test("a name that is neither a command nor a skill is still unknown", () => {
  const outcome = applyComposer(closedDebug, "/nope now", SKILLS);
  assert.equal(outcome.kind, "unknown");
  assert.equal(applyComposer(closedDebug, "/ship").kind, "unknown");
});

test("a built-in command wins a name, and /skill run reaches the skill", () => {
  assert.equal(applyComposer(closedDebug, "/help", SKILLS).kind, "help");

  const run = applyComposer(closedDebug, "/skill run help with  this", SKILLS);
  assert.deepEqual(run, {
    kind: "skill",
    name: "help",
    args: "with  this",
    text: "/skill run help with  this",
    debug: closedDebug,
  });
});

test("/skill without run and a name, or with a skill it cannot run, says how", () => {
  for (const line of ["/skill run", "/skill go ship"]) {
    const outcome = applyComposer(closedDebug, line, SKILLS);
    assert.equal(outcome.kind, "unknown", line);
    if (outcome.kind === "unknown") {
      assert.match(outcome.notice, /\/skill run <name>/);
    }
  }
  const missing = applyComposer(closedDebug, "/skill run nope", SKILLS);
  assert.deepEqual(missing, { kind: "unknown", notice: "no skill named nope to run — /skills lists them" });
});

test("a skill is not held: hold says so and keeps the draft out of the model", () => {
  const held: DebugState = { ...closedDebug, open: true, tab: "model", hold: true };
  const outcome = applyComposer(held, "/ship now", SKILLS);
  assert.equal(outcome.kind, "local");
  if (outcome.kind === "local") {
    assert.match(outcome.notice ?? "", /not held/);
    assert.equal(outcome.debug.held, null);
  }
});

test("only usable skills without user-invocable: false can be run by name", () => {
  const listed: ListedSkill[] = [
    { name: "ship", description: "Ship.", path: "/a", source: "project", usable: true, argument_hint: "[hint]" },
    { name: "facts", description: "Background.", path: "/b", source: "user", usable: true, user_invocable: false },
    { name: "broken", description: "Bad.", path: "/c", source: "user", usable: false },
  ];

  assert.deepEqual(invocableSkills(listed), [{ name: "ship", description: "Ship.", argumentHint: "[hint]" }]);
  assert.equal(applyComposer(closedDebug, "/facts", invocableSkills(listed)).kind, "unknown");
});

const PINS = { pinnable: ["ship", "facts", "help"], active: ["facts"] };

test("/skill pin and /skill unpin name one skill", () => {
  assert.deepEqual(applyComposer(closedDebug, "/skill pin ship", SKILLS, PINS), {
    kind: "skill-pin",
    pin: true,
    name: "ship",
  });
  assert.deepEqual(applyComposer(closedDebug, "/skill unpin facts", SKILLS, PINS), {
    kind: "skill-pin",
    pin: false,
    name: "facts",
  });
});

test("/skill pin and unpin say why when there is nothing to do", () => {
  const notice = (line: string): string | null => {
    const outcome = applyComposer(closedDebug, line, SKILLS, PINS);
    return outcome.kind === "unknown" || outcome.kind === "local" ? outcome.notice : `kind ${outcome.kind}`;
  };
  assert.equal(notice("/skill pin facts"), "facts is already pinned");
  assert.equal(notice("/skill pin nope"), "no skill named nope to pin — /skills lists them");
  assert.equal(notice("/skill unpin ship"), "ship is not pinned — pinned: facts");
  assert.equal(notice("/skill pin"), "/skill pin takes one skill name");
  assert.equal(notice("/skill unpin a b"), "/skill unpin takes one skill name");
});

test("/skill alone lists the pinned skills", () => {
  const listed = applyComposer(closedDebug, "/skill", SKILLS, { pinnable: ["ship", "facts"], active: ["facts", "ship"] });
  assert.equal(listed.kind, "local");
  assert.equal(listed.kind === "local" ? listed.notice : null, "pinned: facts, ship");
  const none = applyComposer(closedDebug, "/skill", SKILLS);
  assert.equal(none.kind === "local" ? none.notice : null, "no skills pinned — /skill pin <name> pins one for this session");
});

test("every usable skill can be pinned, background ones too", () => {
  const listed: ListedSkill[] = [
    { name: "ship", description: "Ship.", path: "/a", source: "project", usable: true },
    { name: "facts", description: "Background.", path: "/b", source: "user", usable: true, user_invocable: false },
    { name: "broken", description: "Bad.", path: "/c", source: "user", usable: false },
    { name: "ship", description: "Hidden by the project's.", path: "/d", source: "user", usable: false },
  ];
  assert.deepEqual(pinnableSkills(listed), ["ship", "facts"]);
});
