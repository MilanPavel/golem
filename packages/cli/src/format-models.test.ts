import assert from "node:assert/strict";
import { test } from "node:test";

import { formatModels } from "./format-models.ts";

test("formatModels marks the default and says what each provider needs", () => {
  const text = formatModels({
    default: "qwen",
    ram_gb: 36,
    models: [
      {
        ref: "ollama/qwen3:8b",
        label: "Qwen3 8B",
        provider: "ollama",
        source: "installed",
        status: "ready",
        profiles: ["qwen"],
        ctx: 40960,
        price: { input: 0, output: 0 },
        size_gb: 5.2,
        fit: "fits",
      },
      {
        ref: "ollama/qwen3:30b-a3b",
        label: "Qwen3 30B-A3B",
        provider: "ollama",
        source: "catalog",
        status: "not_installed",
        price: { input: 0, output: 0 },
        size_gb: 18.6,
        fit: "tight",
      },
      {
        ref: "anthropic/claude-x",
        label: "Claude X",
        provider: "anthropic",
        source: "profile",
        status: "needs_key",
        profiles: ["sonnet"],
        ctx: 200000,
        price: { input: 3, output: 15, cached_input: 0.3 },
      },
    ],
    providers: [
      { provider: "anthropic", status: "needs_key" },
      { provider: "ollama", status: "ready" },
    ],
  });
  assert.equal(
    text,
    [
      "*  ollama/qwen3:8b       qwen    41k   free   5.2 GB         ready",
      "   ollama/qwen3:30b-a3b                free   18.6 GB tight  download",
      "   anthropic/claude-x    sonnet  200k  $3/15                 needs key",
      "",
      "anthropic: no key, golem auth set anthropic to list its models",
      "memory: 36 GB",
    ].join("\n"),
  );
});
