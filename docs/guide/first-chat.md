---
title: First chat
description: Pick a model, ask a first question, and answer golem's first approval.
---

# First chat

This page starts where [Install](../install.md) ends: golem is installed, and its background service is running.

## Open golem in a project

golem works in the folder you start it in. It can read and search files there, and nowhere else.

```bash
cd ~/my-project
golem
```

## Pick a model

On the first start, golem uses your only ready model. If you have several, or none, it opens the model picker. Type `/model` to open it again at any time.

- **Up** and **Down** choose a model, and **Enter** picks it for this chat.
- **`d`** also makes it the default for new chats.
- A local model that is not downloaded yet asks once, then downloads with a progress bar. If Ollama is missing, golem offers to install it with Homebrew first.
- A hosted model needs its API key. Type `/login anthropic` (or the provider you use), and paste the key. Nothing is echoed, and the key goes to the Keychain.

## Ask a first question

Type a message and press **Enter**. **Shift-Enter** starts a new line.

```text
What does this project do? Look at the README and the main folders.
```

The answer streams in. While golem works, you see a line for each tool it uses, such as `read_file README.md`. Press **Ctrl-O** to see what each tool returned.

Reading and searching files inside the folder needs no approval, so a question like this one runs straight through.

## Answer an approval

Ask for a change:

```text
Add a "Getting help" section to the README.
```

Before golem changes a file, the answer stops and asks. In the terminal it looks like this, with the diff of the change between the question and the keys:

```tablet
Allow edit_file README.md?
@@ -40,3 +40,7 @@
+## Getting help
+
+Open an issue, or ask in the discussions.
asked by built-in default
a once · s this session · w always (saves a rule) · e edit · d deny
```

| Key | What it does |
|---|---|
| **a** or **Enter** | Allow this one call |
| **s** | Allow it, and this tool for the rest of the chat |
| **w** | Allow it, and write a rule to `~/.golem/config.toml` so it never asks again |
| **e** | Edit the call's arguments first, then allow it once |
| **d** or **Esc** | Deny it. The model is told the call was denied, and carries on without it |

The [web UI](./web.md) will show the same question as a card. It is the next step of the web UI, so for now answer approvals in the terminal:

::: shem Allow `edit_file` on README.md? | rule: edit_file → ask · built-in default

```diff
 ## Contributing
+
+## Getting help
+
+Open an issue, or ask in the discussions.
```

:::

The line under the question says which rule asked. A command goes through the same question before it runs, and it runs in a sandbox: only inside the folder, and with no network unless you allow it. [Tools and permissions](./permissions.md) explains the rules, and how to stop golem asking for the calls you trust.

## Stop, leave, and come back

- **Ctrl-C** stops the answer. Pressed twice, it quits.
- Closing the terminal does not stop an answer. Run `golem` again in the same folder, and the chat is still there, still streaming.
- `/sessions` switches between chats, and `/new` starts a fresh one.
- `/help` lists every command, and `?` on an empty line lists every key.

## Next

- [How it works](./introduction.md#how-it-works), if you skipped it.
- Open the same chat in your browser with [`golem web`](./web.md).
- [Models and API keys](./models.md) and [Commands](./commands.md), for everything else.
- Something wrong? [When something is wrong](../install.md#when-something-is-wrong) lists the usual fixes.
