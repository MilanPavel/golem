import assert from "node:assert/strict";
import { test } from "node:test";

import { contextKeyLine, contextRowForPress, readContextActions, type ContextActionsRead } from "./context-actions.ts";

const MESSAGES = Array.from({ length: 6 }, () => [
  { role: "user", text: "read it", tokens: 100 },
  { role: "assistant", text: "reading", tokens: 100 },
  { role: "tool", text: "file", tokens: 3000 },
]).flat();

const MEMORY = { ram_gb: 32, size_gb: 16, kv_gb_per_1k_tokens: 0.06, overhead_gb: 1, fits_share: 0.5, tight_share: 0.75 };

function client(fail = false) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      listModels: async () => {
        calls.push("listModels");
        if (fail) throw new Error("down");
        return {
          models: [
            { ref: "ollama/qwen3:27b", label: "qwen3:27b", provider: "ollama", source: "installed", status: "ready", tier: "local", ctx: 131072 },
            { ref: "deepseek/deepseek-chat", label: "deepseek-chat", provider: "deepseek", source: "remote", status: "ready", tier: "budget", ctx: 128000, tools: true, price: { input: 0.28, output: 1.1 } },
          ],
        };
      },
      getRouting: async () => {
        calls.push("getRouting");
        if (fail) throw new Error("down");
        return { context: { keep_results: 4, keep_turns: 4 } };
      },
      getModelOptions: async (model: string) => {
        calls.push(`getModelOptions ${model}`);
        if (fail) throw new Error("down");
        return { memory: MEMORY };
      },
    },
  };
}

const read = (extra: Partial<ContextActionsRead> = {}): ContextActionsRead =>
  ({
    sessionId: "s_1",
    session: { profile: "local", provider: "ollama", name: "qwen3:27b" },
    route: "pinned",
    busy: false,
    changed: false,
    span: { messages: MESSAGES, context: { used: 27000, window: 32768, window_planned: true, num_ctx: 32768, parts: [], estimated: true } },
    ...extra,
  }) as never;

test("the key row lists every row that can run, and only those", async () => {
  const { client: fake, calls } = client();
  const rows = await readContextActions(fake as never, read());
  assert.deepEqual(calls.sort(), ["getModelOptions qwen3:27b", "getRouting", "listModels"]);
  assert.equal(contextKeyLine(rows), "c clear old results · s summarise · g grow to 64K · m larger model");
});

test("a window set by you leaves the grow key out, and a hosted model never has one", async () => {
  const user = await readContextActions(
    client().client as never,
    read({ span: { messages: MESSAGES, context: { used: 27000, window: 8192, window_planned: false, num_ctx: 8192, parts: [], estimated: true } } as never }),
  );
  assert.equal(contextKeyLine(user), "c clear old results · s summarise · m larger model");
  const hosted = client();
  const rows = await readContextActions(hosted.client as never, read({ session: { profile: "deepseek", provider: "deepseek", name: "deepseek-chat" } }));
  assert.ok(!hosted.calls.some((call) => call.startsWith("getModelOptions")));
  assert.equal(contextKeyLine(rows)?.includes("g "), false);
});

test("what cannot be read leaves its row out, and a busy session offers nothing", async () => {
  const rows = await readContextActions(client(true).client as never, read());
  assert.equal(contextKeyLine(rows), "c clear old results · s summarise · g grow to 64K");
  const busy = await readContextActions(client().client as never, read({ busy: true }));
  assert.equal(contextKeyLine(busy), null);
});

test("after a clear the rows that count wait for the next turn", async () => {
  const rows = await readContextActions(client().client as never, read({ changed: true }));
  assert.equal(contextKeyLine(rows), "g grow to 64K · m larger model");
});

test("a plain key runs its row; a key with Ctrl, Alt or a name, or one that names none, does not", async () => {
  const rows = await readContextActions(client().client as never, read());
  const press = (input: string, extra = {}) => ({ name: null, input, ctrl: false, meta: false, ...extra });
  assert.equal(contextRowForPress(rows, press("c"))?.id, "clear");
  assert.equal(contextRowForPress(rows, press("s"))?.id, "summarise");
  assert.equal(contextRowForPress(rows, press("g"))?.id, "grow");
  assert.equal(contextRowForPress(rows, press("m"))?.id, "larger");
  assert.equal(contextRowForPress(rows, press("x")), null);
  assert.equal(contextRowForPress(rows, press("c", { ctrl: true })), null);
  assert.equal(contextRowForPress(rows, press("c", { meta: true })), null);
  assert.equal(contextRowForPress(rows, press("c", { name: "escape" })), null);
  const none = await readContextActions(client().client as never, read({ changed: true }));
  assert.equal(contextRowForPress(none, press("c")), null);
});
