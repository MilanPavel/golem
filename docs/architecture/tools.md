---
title: Tools
description: What a tool call really is, why a failed call is just another result, and how golem's tools node decides, runs, and reports every call.
order: 6
adrs: [11, 15, 16, 17, 18]
---

# {{ $frontmatter.title }}

[The agent loop](./agent-loop.md) runs a tool when the model asks for one. But the model never touches a file. It writes a few words of JSON, and the program does the rest. So how does the model know which tools exist, what does it get back, and what happens when its call is wrong?

## The idea

::: concept In agents generally

A tool is a function the program lets the model ask for. Each one has three parts the model can see:

1. **A name,** such as `grep`.
2. **A description,** in plain words: "Search file contents in the project with a regular expression." This is how the model decides when the tool is useful.
3. **A schema for the arguments,** in JSON Schema: `pattern` is a string, and `path` is an optional string.

The program sends this list with every model call. When the model wants a tool, its reply holds a *tool call*: the tool's name and its arguments, as JSON. The program then:

- **checks the call.** Is it a tool that exists? Do the arguments fit the schema? May it run at all?
- **runs it,** and turns what it returned into text: the *result*.
- **sends the result back,** tied to the call by its id, so the model reads it at the next call.

A call that fails is still a result. "No such file" or "at most one item may be in progress" goes back to the model as text, and the model can try again. A crash would end the whole answer instead.

Some tools change the world: they write a file or run a command. Some only read it. And some change the agent itself, such as a todo list the agent keeps for a long task. That difference decides which calls need a person to say yes, which is the next chapter's subject.

![A tool call: the program offers a list of tools, the model writes a call with a name and arguments, the program runs it and sends back the result. When a call fails, the error goes back as its result, and the model can try again](../images/tools-call.svg)

:::

## How agents usually do it

| Approach | How it works | Good at | Costs |
|---|---|---|---|
| Native tool calling | The API takes the tool schemas and returns calls as structured JSON | Calls parse reliably, and the model was trained for it | Only models that support it, and each provider's format differs a little |
| Calls in the text | The prompt describes the tools, and the program parses lines such as `Action: grep TODO` | Works with any model | Fragile: one odd line and the call is lost |
| Code as the action | The model writes a short program that calls the tools, and the program runs it | Many steps in one model call | It needs a strong sandbox, and errors are harder to read |
| Tools from a server | Another process offers the tools over a protocol such as MCP | Reuse tools that others wrote | You trust another program, which [MCP](../guide/mcp.md) is about |

Native tool calling is the usual choice today. Anthropic, OpenAI, and most local servers support it, and the others are built on top of it.

Every version has to answer the same questions:

- **How big a result may be.** A test log can be megabytes. The model reads every result on every later call, so a big one is slow and costly, and can push the rest out of its context.
- **What a failure looks like.** Bad arguments, a missing file, or a crash inside the tool: the model should read why, and the run should go on.
- **Who may change what.** A tool that writes files needs limits on where. A tool that changes the agent's own state should not reach the rest of it.
- **How many tools.** Every tool's description is in every call. Too many, and the model picks the wrong one, and each call costs more.

## How golem does it

::: golem In golem

golem uses native tool calling. Each tool is a plain Python function with a Pydantic model of its arguments, and the schema the model sees is made from that model. The calls run in the graph's own `tools` node, which decides about every call of a reply first, and only then runs them.

![golem's tools node: for a reply's tool calls it first decides about every call (is the tool here, a preview of a file change, and the rules: allow, ask, or deny), and only then runs them one by one. Each result goes to the model as a ToolMessage and to the screen as tool.completed. Long output also goes to an artifact, and a todo list to graph state](../images/tools-node.svg)

One tool call, in the order it runs:

1. **Offered.** For each model call, `call_model` binds the session's tools: golem's own, and its MCP servers' tools. Each one's schema is in the OpenAI function format, which every chat model's `bind_tools` accepts.
2. **Asked.** When the reply completes, each call in it is a `tool.requested` event, with the tool's name and arguments.
3. **Decided.** The `tools` node checks every call of the reply before it runs any. Does the session have this tool? What would a file change look like? What do the rules say: allow, ask, or deny? A call that asks pauses the run until you answer ([Tools and permissions](../guide/permissions.md)).
4. **Run.** Then the calls run one by one. Each one is `tool.started`. Its arguments are checked against its Pydantic model, and it runs. A shell command streams its output as `tool.output` while it runs.
5. **Result.** `tool.completed` carries a one-line summary for the screen. The model gets the output as a *tool message* in the checkpoint. Very long output is stored as an *artifact*, and the model gets the start and the end of it.
6. **Or a failure.** Bad arguments, a refused path, or an error in the tool is `tool.failed`, and the model reads the same reason as the result. The run goes on.

Here is a real run, recorded against a throwaway home with `qwen3-coder:30b` on a local Ollama. The folder has two files with a TODO, and the message was `Find every TODO in this project and list them. Keep a todo list while you work.` The `message.delta` lines are left out.

```text
seq  event               data
5    message.completed   assistant  ""
6    tool.requested      grep  {"pattern": "TODO"}
7    tool.started
8    tool.completed      2 matches in 2 files
30   message.completed   assistant  "I found two TODO items…"
31   tool.requested      todo_write  2 items, both in_progress
32   tool.started
33   tool.failed         invalid arguments for todo_write
35   message.completed   assistant  ""
36   tool.requested      todo_write  2 items, both pending
37   tool.started
38   tool.completed      0/2 done
39   todos.updated       2 items
129  message.completed   assistant  "I've identified the…"
130  run.completed
```

Three tool calls, and one of them was wrong. At line 31 the model marked both items `in_progress`. The arguments failed `todo_write`'s check, and line 33's full message, which the model read as the result, is `invalid arguments for todo_write: arguments: Value error, at most one todo is in_progress at a time`. At line 36 the model sent the list again, with both items `pending`. Line 39 is the list itself, which the TUI draws as the todo band. Nothing in the run broke.

**Where it lives in the code:**

- `packages/daemon/golem/tools/registry.py`: `Tool`, `ToolRegistry`, `ToolContext`, `ToolResult`, and `ToolError`.
- `packages/daemon/golem/tools/__init__.py`: `default_registry`, the tools every session gets.
- `packages/daemon/golem/graphs/tools_node.py`: `tools_node`, with `_decide` for the first pass and `_for_model` for long output.
- `packages/daemon/golem/graphs/chat.py`: `_ToolBinder`, which offers the tools to the model.

:::

## Why this way

**Plain Python, in golem's own node** ([ADR-011](../adr/011-tools.md)). LangGraph's prebuilt `ToolNode` runs LangChain tools directly. Then the permission check, the events, the approval pause, and long output would have to wrap it from outside, or live in every tool. golem's own node does all of them in one place, and its tools know nothing about LangChain or any provider.

**A failure is a result** ([ADR-011](../adr/011-tools.md)). A bad call never ends the run. The model reads why, and usually fixes the call, as in the trace above.

**Long output is an artifact** ([ADR-016](../adr/016-artifacts.md)). The checkpoint is written every step. A 5 MB test log in it would be written and sent again at every later step. So long output is stored once, and the model reads more of it only when it needs to.

**You approve a diff, not a call** ([ADR-015](../adr/015-write-tools.md)). A file change is planned first, and the approval shows its diff. When the call runs it plans again, and writes only if the diff is the one you saw.

**A web page is data** ([ADR-017](../adr/017-web-fetch.md)). `web_fetch` asks per host, refuses private addresses, and wraps the page so the model treats it as data, not as instructions.

**A tool changes state only through its result** ([ADR-018](../adr/018-tool-state-updates.md)). `todo_write` returns the new list, and the node applies only keys on its allow-list. No tool can reach the messages, the model, or the session.

## Try it

1. In a project folder, open the chat with `golem` and type `/debug wire`.
2. Ask: `Find every TODO in this project. Keep a todo list while you work.` The panel shows `tool.requested grep`, `tool.started`, and `tool.completed`, and the todo band appears with `todos.updated`.
3. Press **Ctrl-O** to see a tool's output, which is what the model read.
4. Ask: `Run seq 1 30000 in the shell.` Allow it. Its output is over 20 000 characters, so the block ends with `all of it: /artifact <id>`. Type `/artifact` to open all of it in your pager.
5. Ask the model to change one line of a file. The approval band shows the diff before anything is written.

## The details

For contributors: the reference for golem's tools, their events, artifacts, todos, the file and web tools, and the shell's output.

### The built-in tools

Every session gets these (`default_registry`), plus the tools of its MCP servers, named `mcp__<server>__<tool>` ([MCP servers](../guide/mcp.md)).

| Tool | What it does | By default |
|---|---|---|
| `read_file`, `list_dir`, `glob`, `grep` | Read the session's project folder, and the folder of each skill the session ran | Allowed: read-only |
| `git_status`, `git_diff`, `git_log` | Read the project's git repository | Allowed: read-only |
| `read_artifact` | Read a page of long output | Allowed: read-only |
| `todo_write` | Replace the agent's todo list | Allowed: internal |
| `write_file`, `edit_file` | Create, replace, or edit a file in the project folder | Asks, per file |
| `shell` | Run a command in the sandbox | Asks, per command |
| `shell_unsandboxed` | Run a command outside the sandbox, with the user's credentials and the network | Asks, per command. Only a rule that names it allows it |
| `web_fetch` | Read one web page as text | Asks, per host |
| `web_search` | Search the web, get titles, URLs, and snippets | Asks, for the provider's host |

A `Tool` says how the rules treat it:

| Field | What it means |
|---|---|
| `read_only` | Changes nothing outside golem, so the default rules allow it |
| `internal` | Changes only golem's own state, such as the todo list, so it is allowed too |
| `untrusted` | Returns outside content, such as a web page, so its output stays marked as data |
| `path_arg`, `match_arg`, `subject` | What a rule's `path` and `match` are checked against: one argument, or a subject worked out from the arguments, such as `web_fetch`'s host |
| `preview` | Works out what a call would change, so the approval can show it |
| `parameters` | A JSON Schema given as it is, for an MCP server's tool. The server checks the arguments |

One call returns at most 5 MB (`MAX_OUTPUT_CHARS`), and the rest is cut.

### Tool events

After a reply completes, each tool call it asked for is `tool.requested`, with the asking `message_id`, the tool name, and the arguments. The `tools` node then writes:

| Event | When | What it carries |
|---|---|---|
| `tool.started` | The call starts to run | `call_id` |
| `tool.output` | A shell command printed something | A batch of its output |
| `tool.completed` | The call returned | A one-line summary, the first 4 KB of the output, and `artifact_id` when it was long |
| `tool.failed` | The call was refused, or failed | The reason |
| `todos.updated` | The call changed the todo list | The whole list |

Output up to 20 000 characters goes to the model as a `ToolMessage` in the checkpoint.

### Artifacts

![Long tool output: output over 20 000 characters is stored whole as an artifact in golem.db. The model reads its first 12 000 and last 4 000 characters, with a note in between that names the artifact, and pages through the rest with read_artifact, up to 20 000 characters at a time](../images/tools-artifact.svg)

Longer output is stored whole in the `artifacts` table, and the message keeps the first 12 000 and the last 4 000 characters and a note with the artifact's id, which `read_artifact` pages through ([ADR-016](../adr/016-artifacts.md)).

- **The cut** happens in the node's run pass, after every approval, so nothing is stored twice when a run resumes.
- **`read_artifact`** reads up to 20 000 characters from an offset, only from the session's own artifacts. A page of an `untrusted` artifact, such as a long web page, comes back in the same wrapper as the page.
- **On the wire,** `tool.completed` carries `artifact_id`, and `artifact.read` returns a page of it. The TUI shows `all of it: /artifact <id>` under an expanded block, and `/artifact` opens the text in `$PAGER`.
- **Without an artifact store,** as in some tests, the model gets at most 100 000 characters of one call.

### Todos

`todo_write` replaces the agent's todo list, which lives in graph state (`todos`) and needs no approval. A tool changes state only through `ToolResult.update`, and the `tools` node applies only the keys in `STATE_KEYS`. Each change is a `todos.updated` event with the whole list, and a fork starts with one for the list it copied ([ADR-018](../adr/018-tool-state-updates.md)).

- **The list** has up to 30 items. Each has an `id`, a `text`, and a `status`: `pending`, `in_progress`, or `done`. Ids are unique, and at most one item is `in_progress`.
- **The output** is the list as a checklist, so the model sees it in its history too. The summary is `N/M done`.

### `write_file` and `edit_file`

![A file change in golem: the tool plans the new text without writing anything, the approval shows its diff, you allow that diff, and when the call runs it plans again. Only when the new plan makes the same diff is the file written. If the file changed in the meantime, the call fails and nothing is written](../images/tools-write.svg)

`write_file` replaces a whole file or creates it, with its folders. `edit_file` replaces exact text, and fails when the text is not in the file, or is there more than once without `replace_all`. Both run in the daemon, not in the sandbox (`golem/tools/write.py`):

- **Where.** The path resolves inside the session folder with symlinks followed, and nothing under a `.golem/` or `.git/` folder may change, so a tool cannot edit the project's rules or its history.
- **Plan, then apply.** Each call first works out the new text without writing anything, then writes it through a temp file in the same folder and a rename, keeping the file mode and the line endings. A file over 5 MB, a binary file, or one that is not UTF-8 is refused.
- **The diff in the approval.** The `tools` node plans each call before it decides, and a call that asks carries the plan's unified diff in `approval.needed` (cut at 64 000 characters). A plan that cannot apply fails the call without asking. A later edit of the same file in the same reply is planned on top of the earlier one. When an approved call runs, it plans again and writes only if the diff is the one you were shown; otherwise it fails with `<path> changed after the user approved this change` ([ADR-015](../adr/015-write-tools.md)).
- **Result.** The summary is `+N -M <path>`, and the output, which the model reads and Ctrl-O shows, is the unified diff.
- **Policy.** Neither is read-only, so by default every change asks. Their subject is the path relative to the folder, so allowing a change for the session allows changes to that file only, and "always allow" writes a rule with that file's exact `path`.

### `web_fetch`

`web_fetch` reads one page over `http` or `https` into the conversation (`golem/tools/web.py`, [ADR-017](../adr/017-web-fetch.md)):

- **Policy.** It is not read-only, so it asks by default. Its subject is the host, lowercased, so "allow for this session" covers one host, and a rule such as `match = "docs.python.org|*.readthedocs.io"` allows those hosts.
- **Addresses.** Before each request, and before each redirect, the host is resolved. A loopback, private, link-local, site-local, reserved, or multicast address refuses the call, IPv4 inside IPv6 included. `[web] allow_private = true` turns this off, for a dev server on `localhost`.
- **Redirects** are followed only on the same host, at most 5. A redirect to another host comes back to the model as the new URL, so its next `web_fetch` asks about that host.
- **The request.** No proxy from the environment, a `golem/<version>` user agent, no compressed bodies, at most `[web] max_bytes` (default 5 000 000) of the body, and `[web] timeout_seconds` (default 20) for the whole fetch. A URL with a user name or password is refused.
- **The page.** HTML becomes text: scripts and styles are dropped, headings become `#`, list items `-`, and links `[text](url)`. Other text, JSON, and XML pass through, and anything else, such as an image, is refused.
- **Data, not instructions.** The text comes inside `<web_content url=… title=…>`, after a line that says it is data and cannot approve anything. The page's own `<web_content` tags are defused, so it cannot end the wrapper early.

### `web_search`

`web_search` searches the web and gives numbered results, each with a title, a URL, and a snippet ([ADR-046](../adr/046-web-search.md)). The model reads a result with `web_fetch`.

- **Provider.** `[web] search` names it: `"duckduckgo"` (the default) or `"off"`, which leaves the tool out when the daemon starts. A provider is one module with `async search(query, n) -> list[Result]` (`golem/tools/search_provider.py`). DuckDuckGo's is `golem/tools/search_duckduckgo.py`.
- **Policy.** Not read-only, so it asks. The subject is the provider's host (`html.duckduckgo.com`), so one rule allows searches without allowing every query.
- **The request.** `POST https://html.duckduckgo.com/html/` with the form field `q`, with the same user agent as `web_fetch`. Two searches start at least 5 seconds apart, and the wait counts toward `[web] timeout_seconds`. The page is read with the standard library's parser. A result's link is a redirect, and the URL inside it is the one returned.
- **Failures.** No results is a result: `no results for '…'`. HTTP 202, 403, or 429, or a page without the results list, is an error that says DuckDuckGo refused the search, and to wait a minute or answer from what was found.
- **Data, not instructions.** The results come inside `<web_content query=…>`, after a line that says they are data.

### The shell's output

`shell` runs the user's login shell (`$SHELL -lc`) in the session folder, under the sandbox, which [Sandboxes](./sandboxes.md) describes.

- **Output** is stdout and stderr together. It streams as `tool.output` in batches of up to 2 KB or 0.2 s, up to 64 KB per call. Up to 5 MB is kept (the first 1 MB and the last 4 MB), then `[exit code N]`, and long output becomes an artifact. A failing command is a `tool.completed` with summary `exit N` and `failed: true`, not a `tool.failed`: it ran, and the model gets its output. A timeout is marked the same way. The transcript shows `✗` for it instead of `✓`. When the sandbox refused something, the summary ends with `, blocked by the sandbox`, and a line before `[exit code N]` says what and how to allow it ([Sandboxes](./sandboxes.md#the-shell-sandbox)). With the network off, a command that names a network client also gets a hint line after `[exit code N]`.
- **Stopping.** The command runs in its own process group. `[shell] timeout_seconds`, or a smaller `timeout_seconds` in the call, kills the group, and so does cancelling the run.

### Files

| File | What it does |
|---|---|
| `packages/daemon/golem/tools/registry.py` | `Tool`, `ToolRegistry`, `ToolContext`, `ToolResult`, `ToolError`, and `MAX_OUTPUT_CHARS` |
| `packages/daemon/golem/tools/fs.py` | `read_file`, `list_dir`, `glob`, and `grep` |
| `packages/daemon/golem/tools/paths.py` | Keeps paths inside the session folder and the skill folders |
| `packages/daemon/golem/tools/write.py` | `write_file` and `edit_file`: plans, previews, and writes |
| `packages/daemon/golem/tools/shell.py` | `shell`, `shell_unsandboxed`, `git_status`, `git_diff`, and `git_log` |
| `packages/daemon/golem/tools/web.py` | `web_fetch` |
| `packages/daemon/golem/tools/search.py`, `search_duckduckgo.py` | `web_search` and its DuckDuckGo provider |
| `packages/daemon/golem/tools/html_text.py` | HTML to text, for `web_fetch` |
| `packages/daemon/golem/tools/untrusted.py` | The wrapper for outside content |
| `packages/daemon/golem/tools/artifacts.py` | `read_artifact` |
| `packages/daemon/golem/tools/todos.py` | `todo_write` |
| `packages/daemon/golem/graphs/tools_node.py` | The `tools` node: decide, run, results, artifacts, and state updates |
| `packages/daemon/golem/store/artifacts.py` | `ArtifactStore`, the `artifacts` table |

## Read more

- Next: [Permissions](./permissions.md), the rules and approvals that decide whether a call may run.
- Before: [Sessions](./sessions.md).
- [Tools and permissions](../guide/permissions.md), the user's guide to the same thing.
- [The overview](../architecture.md): the whole system on one page.
- [Anthropic's guide to tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview), for native tool calling from the provider's side.
