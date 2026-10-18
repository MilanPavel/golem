import assert from "node:assert/strict";
import { test } from "node:test";

import type { Press, PressName } from "./keys.ts";
import { maskSecret, openSecret, pasteSecret, pressSecret, type SecretPrompt } from "./secret.ts";

function press(name: PressName | null, input = ""): Press {
  return { name, input, ctrl: false, meta: false };
}

function typed(prompt: SecretPrompt, text: string): SecretPrompt {
  let current = prompt;
  for (const char of text) {
    const step = pressSecret(current, press(null, char));
    assert.ok(step.prompt !== null);
    current = step.prompt;
  }
  return current;
}

test("typing builds the key and Enter submits it trimmed", () => {
  const prompt = typed(openSecret("anthropic"), "sk-abc");
  assert.equal(prompt.value, "sk-abc");
  const step = pressSecret(prompt, press("return"));
  assert.equal(step.prompt, null);
  assert.deepEqual(step.submit, { provider: "anthropic", key: "sk-abc" });
});

test("Enter on an empty prompt keeps it open", () => {
  const prompt = openSecret("openai");
  const step = pressSecret(prompt, press("return"));
  assert.equal(step.prompt, prompt);
  assert.equal(step.submit, null);
});

test("Esc and Ctrl-C cancel without submitting", () => {
  const prompt = typed(openSecret("openai"), "sk");
  for (const name of ["escape", "ctrl-c"] as const) {
    const step = pressSecret(prompt, press(name));
    assert.equal(step.prompt, null);
    assert.equal(step.submit, null);
  }
});

test("Backspace deletes one character and Ctrl-U clears", () => {
  const prompt = typed(openSecret("groq"), "abc");
  assert.equal(pressSecret(prompt, press("backspace")).prompt?.value, "ab");
  assert.equal(pressSecret(prompt, press("ctrl-u")).prompt?.value, "");
});

test("keys that move or scroll do nothing", () => {
  const prompt = typed(openSecret("groq"), "abc");
  for (const name of ["up", "down", "tab", "page-up", "ctrl-g", "left"] as const) {
    assert.equal(pressSecret(prompt, press(name)).prompt, prompt);
  }
});

test("a pasted key drops its whitespace", () => {
  assert.equal(pasteSecret(openSecret("openrouter"), "  sk-or-1\n").value, "sk-or-1");
});

test("the mask shows dots, then the length for a long key", () => {
  assert.equal(maskSecret("abc"), "\u2022\u2022\u2022");
  assert.equal(maskSecret("x".repeat(60)), `${"\u2022".repeat(24)} 60 chars`);
});
