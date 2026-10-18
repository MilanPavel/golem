import assert from "node:assert/strict";
import { test } from "node:test";

import { formatKeys } from "./format-keys.ts";

test("formatKeys says where each key is and skips providers that take none", () => {
  const text = formatKeys([
    { provider: "anthropic", takes_key: true, needs_key: true, env_var: "ANTHROPIC_API_KEY", source: "keychain" },
    { provider: "lmstudio", takes_key: true, needs_key: false, env_var: null, source: null },
    { provider: "ollama", takes_key: false, needs_key: false, env_var: null, source: null },
    { provider: "openai", takes_key: true, needs_key: true, env_var: "OPENAI_API_KEY", source: "env" },
    { provider: "openrouter", takes_key: true, needs_key: true, env_var: "OPENROUTER_API_KEY", source: null },
  ]);
  assert.equal(
    text,
    [
      "anthropic   in the Keychain",
      "lmstudio    none needed",
      "openai      from OPENAI_API_KEY",
      "openrouter  missing: golem auth set openrouter",
    ].join("\n"),
  );
});
