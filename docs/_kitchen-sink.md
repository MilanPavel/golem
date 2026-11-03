---
# Not in the side menu or the search. A sample of each of golem's blocks (containers.ts),
# to check them in slip and kiln and at phone width after a change to the theme.
title: Kitchen sink
search: false
prev: false
next: false
---

# Kitchen sink

One of each block the docs theme adds, then VitePress's own, in golem's colours.

## The shem: an approval

::: shem Allow `edit_file` on connect.ts? | rule: **edit_file → ask** · built-in default

```diff
     current.on("data", (chunk: Buffer) => {
-      buffer += chunk.toString("utf8");
+      // stream: true keeps a split character for the next chunk
+      buffer += decoder.decode(chunk, { stream: true });
       let newline = buffer.indexOf("\n");
```

:::

::: shem May golem run `pytest -q`?
golem runs it in the sandbox, in this folder only. No network.
:::

## The tablet: a command's output

```tablet read_file packages/client/src/connect.ts 600–640 · 41 lines
605  function openSocket(): net.Socket {
606    const current = net.createConnection(socketPath);
607    current.setEncoding("utf8");
…
619    buffer += chunk.toString("utf8");
```

```tablet
run.started        seq 3
tool.requested     seq 6  list_dir  {"path": "."}
tool.completed     seq 7  list_dir  12 entries
run.completed      seq 12
```

## The screen: a TUI screen

```screen A4 · Engine | Enter on **On this Mac** → A5
✓ Service ── ● Engine ── ○ Model ── ○ Ready

Where should golem think?

› On this Mac      private, free · uses Ollama
  With an API key  Anthropic, OpenAI, Groq, OpenRouter…
  Later            golem can't answer until you pick

⠸ brew install ollama                              41s
  downloading  ███████████░░░░░░░  118 / 190 MB
❯ ••••••••▏

Enter picks · ↑↓ move · Esc back · q quit
```

## The two halves of a concept page

::: concept
An agent is a loop. The model reads the conversation and either answers or asks for a tool. The program runs the tool, adds the result, and asks the model again.
:::

::: golem
golem runs the loop in the daemon, one turn at a time, as a LangGraph graph. Each step is written down before the next one starts, so a crash loses nothing. See `packages/daemon/golem/graphs/`.
:::

## VitePress's own

::: tip
A tip takes golem's allow colour.
:::

::: warning
A warning takes the wait colour.
:::

::: danger
Danger takes the deny colour.
:::

::: details A details block
Hidden until it is opened.
:::
