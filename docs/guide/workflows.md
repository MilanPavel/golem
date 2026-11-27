---
title: Workflows
description: Write a workflow in Python, run it from the terminal, and see each step saved, restarted and kept once.
---

# Workflows

A **workflow** is a Python function that runs a series of steps. You decide the order. golem saves every step, so a restart does not repeat finished work.

Use a workflow when the same job comes back: every Monday, for each file in a folder, or for each package that is out of date. Use a [routine](./routines.md) when one prompt is enough, and a [skill](./skills.md) when a model should follow written instructions.

| Word | Who decides the next step | Written as |
|---|---|---|
| Skill | The model, following instructions | `SKILL.md` |
| Routine | The when: a time or a new file. It can start a workflow | `[[routine]]` in `config.toml` |
| Workflow | Your code | `workflows/*.py` |

## Where the files go

| Folder | Loads when |
|---|---|
| `~/.golem/workflows/` | Always. It is your own folder |
| `<project>/workflows/` | The project is in `trusted_projects` in your config |

`~/.golem` moves when `GOLEM_HOME` is set. A project's folder counts only when you trust it, so a repository you clone cannot run code on your Mac.

## Your first workflow

This one needs no network and no model. It counts the lines in three Markdown files and adds them up.

```python
# examples/workflows/hello.py
from pathlib import Path

from golem.workflow import Run, workflow


def find_files(folder: str) -> list[str]:
    files = sorted(str(p) for p in Path(folder).expanduser().glob("*.md"))
    if len(files) < 3:
        raise ValueError(f"need three .md files in {folder}, found {len(files)}")
    return files[:3]


def count_lines(path: str) -> int:
    with open(path, encoding="utf-8") as handle:
        return sum(1 for _ in handle)


def add_up(counts: list[int]) -> int:
    return sum(counts)


@workflow(
    inputs={"folder": str},
    title="Count the lines",
    description="Count lines in three Markdown files.",
)
async def hello(run: Run) -> None:
    files = await run.step("Find the files", find_files, run.inputs["folder"])
    counts = await run.parallel(
        [run.step("Count lines", count_lines, f, item=Path(f).name) for f in files],
        title="Each file",
    )
    await run.step("Add up", add_up, counts)
```

| Part | What it does |
|---|---|
| `@workflow(inputs=)` | Marks the function as a workflow. It starts when you ask, or when a [routine](./routines.md) starts it. A `trigger=` is still accepted but never used: the check says so |
| `run.inputs` | The values you pass with `--input` |
| `run.step(name, fn, *args)` | Runs `fn` once and saves its result under `name` |
| `run.parallel([...])` | Runs the steps at the same time and returns their results in order |
| `title=`, `item=` | Words for the page and the terminal (see [Titles and items](#titles-and-items)) |

To try it, copy the file into your workflows folder:

```bash
cp examples/workflows/hello.py ~/.golem/workflows/
```

## Start a new workflow in the web app

**+ New workflow** at the top of the Workflows panel opens one page with the ways in. Each asks for a name ("Weekly invoices" becomes the file `weekly_invoices.py`) and where to save it: your own folder, or the `workflows` folder of the project you are in (it must be trusted). A name already in use is said beside the field with a free one to use; an existing file is never overwritten.

- **Describe it**: a few sentences, and golem writes the steps. They open in the editor as a draft: the steps in words, the code beside, the checks run, nothing run and nothing saved until you press Save. golem's default model writes it, unless you pick another in the model picker beside it; a picked model is also written in the file as `@workflow(model=...)`, and no model is written otherwise.
- **A starter**: the starter cards are on this page.
- **Empty file**: a two-step skeleton, created at once and opened in Code view.
- **From a chat** is not here yet.

After the first Save, golem asks "Run it on a schedule?"; Yes opens New routine filled in with the workflow.

## Start from a starter

```bash
golem workflow starters
golem workflow add morning_briefing
golem workflow add morning_briefing --routine
```

`morning_briefing` goes in `~/.golem/workflows`: it reads your project folders, logs and feeds, and leaves one short briefing (markdown, with a one-line summary) as the run's result, in the Inbox, and as a copy in `~/.golem/briefings`. It reads only the three lists `PROJECTS`, `LOGS` and `FEEDS` at the top of the file, so open the file and fill them in; when a list is empty the briefing says at the end what it could not cover. It names no model: its model step runs on golem's default model. A workflow does not run by itself: a routine schedules it. With `--routine` golem also adds the routine `morning-briefing` (`weekdays 07:30`) that starts it; without it you add a routine yourself in Routines. If the routine cannot be added (its name is taken, say), the workflow is still added and golem says why. The New workflow page offers the same starters, with an "Add and run every weekday at 07:30" button. An existing file is never overwritten.

## Run it

```bash
golem workflow list
golem workflow run hello --input folder=~/notes
```

`list` shows every workflow, and any broken file with its error. `run` prints each step as it runs, then the result. Sample output:

```text
hello  started
  find files          done   3 files
  count a.md          done   42
  count b.md          done   17
  count c.md          done   8
  add up              done   67
hello  done
```

The exact layout may differ slightly. The run also appears in `golem runs`.

### In the chat

Type `/workflows` in the terminal chat for the same list: workflows of this project first, then yours. Below the list the selected workflow shows its outline, as the Overview tab does: the numbered steps with their kind, agent, `for each` and `if` lines. When the newest run has a step, its start time shows beside it, and the header gives that run's time, result and cost. A broken file shows its traceback instead of the outline, and one that is not trusted says to trust the project first and has no key that runs.

| Key | What it does |
| --- | --- |
| `e` | Opens the workflow's file in `$EDITOR` (`vi` when it is not set), then reads the outline again |
| `r` | Opens a small form with a field for each input. A field marked `*` is required, one with a default starts with it, and a number, a yes/no (`Space` flips it) or a choice (`←`/`→` picks) is checked before it is sent. `Enter` starts the run and opens it |
| `Enter` | Opens the newest run of this workflow |
| `h` | Lists this workflow's runs, newest first. `Enter` opens one |
| `Esc` | Goes back, then closes |

`/runs` lists workflow runs with the routine runs, also the ones a routine started. `Enter` on one opens its steps, which follow the run live: a mark, the time and the result of each step. The selected step unfolds. An agent step shows its helper session (`Enter` opens its chat), and a worker step shows its copy, the files changed, `+added −removed` and its checks. When the run waits for a review the draft shows under the steps: `y` approves, `n` rejects, and `r` opens the run's chat to edit the draft in the review band. `c` cancels a run that has not ended (also from the `/runs` list), and `s` resumes one that failed. `Esc` goes back.

## The rules

| Rule | Why it matters |
|---|---|
| Step names are unique within a run. A step's name is its key unless you pass `key=` | A repeated key fails the run with an error. It never returns an earlier result by mistake. In a loop, use a name per item, such as `f"count {name}"` |
| Names stay the same between runs | Resume finds each saved result by its name. A name with a timestamp in it cannot be found again |
| After a restart the function runs again from the top | Code outside steps runs again, so keep it free of side effects |
| Finished steps return their saved result | Their function does not run a second time |
| Code inside a step runs once per run | Put reads, writes, network calls and model calls inside steps |
| Results must be JSON | Return numbers, strings, booleans, `null`, lists and dicts. Other values fail the step |
| Plain functions run in a worker thread, `async` ones are awaited | A slow plain function does not block the daemon |
| Input values are strings unless your type says otherwise | Convert them in your code, for example `int(run.inputs["count"])` |

### Real-world actions: `key=`

Pass `key=` to a step that changes something outside golem, such as opening a pull request or sending an email.

```python
await run.step(f"PR {pkg}", open_pull_request, pkg, key=f"pr:{pkg}:{version}")
```

- A keyed step that finished never runs again, across retries and restarts.
- A crash after the action but before golem saves its result leaves the step **may have run** (`in_doubt`). golem then runs it again and tells the function so.
- Use a key that is stable and specific, such as the package and version, not a random value.
- A step without `key=` that was running when golem stopped just runs again, so keep plain steps safe to repeat.

Inside the step function, pass the key to the receiver and check whether this is a second try:

```python
from golem.workflow import idempotency_key, may_have_run

def open_pull_request(pkg):
    if may_have_run() and branch_exists(pkg):   # the first try may have got through
        return existing_pr(pkg)
    return github.create_pr(pkg, headers={"Idempotency-Key": idempotency_key()})
```

`idempotency_key()` is the step's `key=` (None outside a keyed step). `may_have_run()` is true only on the run after a crash. A receiver that understands the key drops the second copy.

### Titles and items

A step is listed under a title, in words. You can set it with `title=` on `run.llm`, `run.agent`, `run.skill`, `run.review` and `run.parallel` (the group), and on `@workflow` (the name of the workflow). `run.notify` already has `title=`. `run.tool` has none, because its keyword arguments belong to the tool; it is listed under the tool's name.

Without a `title=` the title is the step's name for `run.step`, the key in words for `run.llm` (`key="read-invoice"` reads "Read-invoice", no key reads "Ask the model"), "Worker agent" for `run.agent("worker", ...)`, and the skill's name for `run.skill`. A title is never a prompt, a brief or the text of a notice.

`run.step` also takes `item=`, the part that changes in a loop:

```python
await run.parallel(
    [run.step("Count lines", count_lines, f, item=Path(f).name) for f in files],
    title="Each file",
)
```

The page shows "Count lines" and the item after it. `item=` is kept as text (cut at 80 characters) and is never passed to the function. Without `key=`, the item is part of the step key (`Count lines: a.md`), so the steps of a loop need no names that change. Titles and items are only labels: a file that uses none of them runs, and resumes a run made before, exactly as it did.

While a run goes, its page counts steps against what golem reads from your file (the number of `run.step`, `run.llm` and other calls), and says "5 steps so far" when it cannot know, for example when a step sits under an `if`. A loop is one row. Pass `of=` with the number of items when you know it, and the row says "12 of 30" instead of "12 so far":

```python
await run.step("Read feed", read, url, item=url, of=len(feeds))
```

`of=` is a label too; it is never passed to the function.

### Progress while a step works

A step that takes a while can say how far it is. Call `run.progress(text)` inside the function of a `run.step`; the run page shows the text on the step that works:

```python
def read_all(run, feeds):
    for n, url in enumerate(feeds, 1):
        fetch(url)
        run.progress(f"{n} of {len(feeds)}")
```

`run.progress` is not a step and nothing is saved. It sends at most four times a second (the last text always goes out), and outside a step it does nothing. A `run.llm` step needs no call: when the model can stream, its answer is shown on the page as it is written. A model that answers in one piece shows nothing until it is done, as before. A page that you open in the middle of a run shows the text so far.

The page also says "usually about 45s" while a run goes, from the median time of the last five runs of the workflow that finished. It says nothing until two have.

### Retries

```python
await run.step("fetch", fetch_page, url, retries=2, backoff=5)
```

`retries=2` runs the function up to 3 times, waiting `backoff` seconds before each new try. The step's `attempts` counts them. When the last try fails, the step and the run fail, and the run's error names the step and its error.

### Telling you something

```python
await run.notify("Release 1.4 is out", title="Release")
```

`run.notify(text, title=None, key=None)` sends a banner through the Notifier and is saved as a step of kind `notify`, so a run that is executed again does not send it twice. The step key is `key` or `notify:<text>`; inside a loop, give each notice its own `key=`. A click on the banner opens the run's session (when the run has none, the banner has no open hint). Without a notifier the step still completes.

### What came out

```python
await run.output(report_path, title="Weekly report", summary="12 pull requests, 3 need you")
return {"merged": 9}
```

`run.output(value, title=None, summary=None)` marks a result of the run: text, a record, rows, a file path or a URL. Call it as often as you like; the results are kept in order. It is not a step. A run that is executed again after a restart or a resume marks the same results again, and the ones already saved are kept, so none shows twice. `summary` is one line for a list; the summary of the first output is the run's summary.

What the workflow function returns is saved on the run as its `result`. A workflow that marks no output still shows its return value.

An output that is an absolute path to a text file can be read with `workflow.read_output {workflow_run_id, index}`. Only a path the run marked is read, a file in a secret folder (`~/.ssh`, `~/.golem`, and the like) is refused, and a long file is cut with `truncated` set.

### Asking an agent

```python
found = await run.agent("explorer", "List the TODOs in src/", model="qwen3.5:9b")
print(found["answer"])
```

`run.agent(type, brief, model=None, key=None, gets=(), budget=None, worktree=None)` runs one agent of that type (the same agents `delegate` uses) as a helper of the run's session, with golem's permissions. It returns `{"status", "answer", "session_id"}`; open `session_id` to see everything the agent did. The step has kind `agent` and the key `key` or `agent:<type>`; give two agents of one type their own `key=`.

- `model=` is the name of a model you have set up, as the chat's model picker shows it. See [Which model](#which-model). Without a model written in the step, the run or the workflow, the agent's own wish is used. A local-only folder never gets a hosted model: the step stops and says why.
- An approval the agent needs shows on the run's session, so the run shows "needs you".
- An agent that fails or is stopped fails the step, and the error says why.
- After a restart the run continues and waits for the same agent. It never starts a second one.
- `gets=["diff"]` hands the agent what `delegate` hands a helper whose file says `gets`: the run's diff, as a file it can read. It is added to what the agent's own file asks for. Other values fail the step.
- `budget="$0.50"` (or `budget=0.5`) caps what this one agent may cost. An agent that reaches it stops with `cost` and fails the step, and the error says so. If the agent's file or `[agents] max_cost` has a lower cap, the lower one wins. A local model has no price, so the cap never fires for it.

#### Agents at once

```python
reports = await run.parallel(
    [run.agent("explorer", f"Check {pkg}", key=f"check-{pkg}", budget="$0.20") for pkg in packages]
)
```

The agents inside one `run.parallel` start as one batch, like several helpers of one `delegate`: they share one call (`wf:parallel-N`), and each has its place in the list. The helper limit `[agents] at_once` applies to the whole batch, so with a limit of 2 the first two run and the rest wait their turn (the run's session shows why they wait). Each agent still has its own step, key and `child_session_id`. After a restart each agent is found again by its place, and none starts twice. An agent on its own, outside `run.parallel`, is a batch of one.

### Workers in copies

An agent with tools that change files (`worker`, or your own agent that lists `write_file`, `edit_file` or `shell`) never writes in your folder. golem makes a git copy of the run's folder for it, and the agent works there. The run's folder must be a git checkout; if it is not, the step fails with the reason. A read-only agent works in no copy.

```python
w = await run.agent("worker", "Upgrade httpx to 0.28 and fix what breaks", worktree="upgrade/httpx")
```

`worktree=` names the copy in the step and in its result. Without it the agent still works in a copy, and the name is the step key. It fails the step for an agent that only reads.

When the worker ends, golem stores its diff and runs the project's checks in the copy. The step's result is the usual `status`, `answer` and `session_id` plus:

| Key | Meaning |
|---|---|
| `worktree` | the name of the copy |
| `diff` | the artifact id of the diff, or `None` when nothing changed |
| `files` | the changed files: `path`, `status`, `added`, `removed` |
| `added`, `removed` | lines added and removed over all files |
| `checks` | `passed`, `failed` or `none` |
| `checks_failed` | the names of the failing checks |
| `checks_note` | why `checks` is `none`, such as `no checks found` |

The result is saved as the step's JSON, so a run that is executed again gets it back without starting the worker. After a restart the same worker and the same copy are waited for. The copy is kept; apply the diff from the Changes tab of the worker's thread, or look at it first.

### Asking a model one question

```python
summary = await run.llm(f"Summarise in one line:\n{text}")
facts = await run.llm(text, schema=Facts, model="deepseek/chat")
```

`run.llm(prompt, schema=None, model=None, key=None)` makes one model call, with no tools and no agent loop, and saves it as a step of kind `llm`.

- Without `schema` it returns the text. With `schema` (a Pydantic model class or a JSON-schema dict) the model is asked for a JSON object and the call returns it as a dict. An answer that does not fit fails the step.
- `model=` is the name of a model you have set up (see [Which model](#which-model)). Without one the workflow's model is used, then golem's default model, the one a new chat starts with. `[routing.roles]` plays no part.
- In a local-only folder a hosted model is not used: the step stops and says why. A spent budget cap stops a paid model the same way it stops a chat.
- The call takes a slot from the dispatcher, like a title, so it waits behind a chat on the same local model.
- The step saves the model that answered and what the call cost (`workflow.status` shows both on the step). A run that is executed again does not ask again.
- The step key is `key` or `llm:<short hash of the prompt>`. Two calls with the same prompt in one run need their own `key=`.

### Which model

```python
@workflow(model="qwen3.5:9b")            # the default of this workflow
async def briefing(run):
    facts = await run.llm("Collect the facts")                 # qwen3.5:9b
    text = await run.llm(facts, model="deepseek/chat")         # this step's own
    await run.skill("tidy", text, model="qwen3.5:9b")
```

A model step (`run.llm`, `run.agent`, `run.skill`) uses the first of these:

1. This run's choice: `golem workflow run <name> --model NAME`, or the model asked for in `workflow.start` (and `workflow.resume`) by the Run dialog.
2. The step's own `model="..."`.
3. The workflow's `@workflow(model="...")`.
4. golem's default model: the one a new chat starts with.

A name is a model you have set up, as the chat's model picker shows it: a profile, or `provider/model`. `[routing.roles]` is for chats and plays no part here.

- **Not set up on this machine.** The check says so beside the line. The run is not refused when it starts; the step that cannot get its model stops with that reason, and the steps before it are kept.
- **Local-only folders.** A hosted model is never used there. The step stops and says the folder stays on this Mac. A spent budget cap stops a paid model as it does in a chat.
- **Old wish words.** `cheapest`, `same`, `stronger`, `local`, `budget` and `frontier` keep working exactly as before in files that have them. The editor does not offer them any more, and the check suggests a model name instead.
- **The editor.** The header shows the workflow's model (`Model golem's default model · now ...`, or the name written in the file). A model step has a Model field. Both write `model=` into the code as an unsaved edit.

### Calling a tool

```python
prs = await run.tool("mcp__github__list_pull_requests", repo="golem")
await run.tool("mcp__github__create_issue", key="file-bug", title="Build is red")
```

`run.tool(name, key=None, **args)` calls one golem tool or MCP tool (`mcp__<server>__<tool>`) with no HTTP code. It returns the tool's output as text (an MCP tool's text without the data note around it). The step has kind `tool` and the key `key` or `tool:<name>`; give two calls of one tool their own `key=`. A tool argument can not be called `key`.

The rules are the chat's, so a tool is allowed, denied or asked in the same cases:

| Rule says | What happens |
|---|---|
| allow | The tool runs |
| deny | The step fails, and the error is the rule's reason (for example `mcp__github__delete_repo is denied by config.toml`) |
| ask | The run is `waiting` and holds nothing, like `run.review`. The question `Run <tool>?` shows in your Inbox as a `review` item with the tool and its arguments. `golem workflow answer` approves it (the tool runs and the workflow goes on) or `--reject`s it (the step fails). An `--edit` counts as a no |

- An explicit `key=` marks the call as a real-world action, as in `run.step`: `idempotency_key()` works inside the tool, and a tool that has an `idempotency_key` argument gets it filled in.
- Output over 4 KB is stored as an artifact of the run's session. The step keeps a one-line summary and the artifact id; `run.tool` still returns all of it, also after a restart.
- A tool that is unknown, or called with arguments that do not fit, fails the step.

### Running a skill

```python
notes = await run.skill("release-notes", args="v1.4", key="notes")
```

`run.skill(name, args="", key=None)` runs one skill as one short agent turn and returns the final answer as text. The skill's body, with `args` filled in as `/name args` does in the chat, is the brief of a helper of the run's session. The helper gets the explorer agent's read-only tools plus the ones the skill's `allowed-tools` names, with golem's permissions. A skill that names tools that change things (`edit_file`, `shell`, ...) runs as a worker in a copy instead (see [Workers in copies](#workers-in-copies)): it gets the `worker` agent's tools plus its own. It has its own thread, so the step shows `child_session_id` and you can open it. The step has kind `skill` and the key `key` or `skill:<name>`; give two runs of one skill their own `key=`.

- A skill that is unknown, disabled, or broken fails the step. For an unknown name the error lists the skills the run's folder sees.
- A helper that fails or is stopped fails the step, and the error says why.
- After a restart the run waits for the same helper. It never starts a second one.

### Example: a PR digest

`examples/workflows/pr_digest.py` lists the open pull requests with `run.tool`, has a model write one line for each (all at once, in `run.parallel`), asks you to look over the notes with `run.review`, and ends with `run.notify`. The tool name and the repo are inputs, so it works with any MCP server that can list pull requests:

```
golem workflow run pr_digest --input tool=mcp__github__list_pull_requests --input repo=golem
```

Steps: `tool:<name>`, `summarise #<n>` for each PR, `review:...`, `notify:...`. A `deny` rule on the tool fails the first step with the rule's reason, and nothing else runs. To have a skill write the notes instead of you, replace the review with `await run.skill("pr-notes", args=digest)`.

## Waiting for you

```python
@workflow()
async def weekly_mail(run: Run):
    draft = await run.step("write", write_mail)
    answer = await run.review(draft, ask="Send this to the team?")
    if answer["verdict"] == "reject":
        return "dropped"
    await run.step("send", send_mail, answer["text"], key="send")
```

`run.review(draft, ask="Review this", key=None)` stops the run and waits for you, for minutes or days. While it waits the run is `waiting` and holds no task, slot or model. Your answer comes back as `{"verdict": "approve" | "edit" | "reject", "text": str}`:

| Verdict | `text` |
|---|---|
| `approve` | The draft, as it was |
| `edit` | Your version |
| `reject` | What you typed, or empty. The workflow decides what a reject means; it does not fail the run |

`draft` must be JSON (a string, a list or a dict). The step key is `key` or `review:<ask>`; two reviews with the same ask need distinct `key=` values. Inside `run.parallel`, every member finishes first, and each review is a separate question, so several can wait at once.

The question shows in your Inbox as a `review` item for the run's session (`golem runs` lists the run as `waiting`, with the ask). Answer it from a shell:

```bash
golem workflow answer wr_123                       # approve
golem workflow answer wr_123 --edit "Hi team, ..." # use your text
golem workflow answer wr_123 --reject
golem workflow answer wr_123 --key send-mail       # when the run waits on several reviews
```

Without `--key` the run must wait on exactly one review. The command then follows the run's steps like `resume`. The run continues once none of its reviews waits; an answered review is not asked again, even after a restart. A review answered twice is refused.

## Run a workflow from a routine

A routine is the only "when" of a workflow. A `[[routine]]` can start a workflow instead of a prompt. In the web app, New routine from a workflow's page opens the form with the workflow chosen. Give it `workflow` (the workflow's name) and `inputs`, and leave `prompt` out: a routine has exactly one of the two.

```toml
[[routine]]
name = "pr-digest-daily"
schedule = "weekdays 08:30"
workflow = "pr_digest"
inputs = { tool = "mcp__github__list_pull_requests", repo = "acme/api" }
```

- The routine starts the run through the workflow service, so it gets its own headless session, survives a restart and stops at each `run.review` like any run. The run's trigger is `routine:<name>`, and the routine's history row points at the run.
- The firing stays **running** while the run works and reads **waiting** while it waits for your review. Answer it as usual (`golem workflow answer`, the Inbox). The firing ends when the run is done, failed or cancelled.
- Inputs are checked against the workflow's declared inputs: an unknown name or a value of the wrong type is a routine problem. `routine.list` shows it in its `issues`, `routine.update` refuses to save it, and a firing that cannot start is a `failed` history row that says why. A missing or broken workflow is handled the same way.
- A project routine looks for the workflow in the project's `workflows/` folder first, then in your own.
- A workflow routine takes no `folder`, `model` or `mcp`: the workflow chooses its own.
- A routine with `on = { watch, glob }` passes the new file's absolute path as the input `path`, so the workflow must declare `path`.
- `golem routines` shows `workflow: <name>` for such a routine.

See [Routines](routines.md) for schedules and file watching.

## Broken and untrusted files

| Case | What you see | What runs |
|---|---|---|
| The file fails to import, or has a syntax error | `golem workflow list` shows it as **broken**, with the traceback | Nothing. The rest of the workflows still work |
| The file is in an untrusted project | It is not listed as runnable, and the list says why | Nothing |
| A workflow raises an error | The run is `failed`, with the step that failed | Only that run stops. The daemon keeps going |
| The file calls `sys.exit()`, hangs or crashes on import | The file is **broken** | Import runs in a short-lived subprocess, so the daemon is not affected |

A broken file never disappears from the list. Fix it and it loads again.

## Check

golem can tell you what is wrong with a workflow file before it runs. The check reads the text only: it does not import the file and does not ask a model, so it works on a broken or untrusted file too.

```
$ golem workflow check digest
line 12 · step agent:explorr · unknown agent 'explorr'; the agents here are explorer, worker (fix: explorer)
line 15 · step llm:ask · warning: the wish 'stronger' would use a paid model, and this folder is local-only: a run would stop at this step
```

Each line says the line of the file, the step (from the outline) and the problem. The command exits 1 when there is an **error**, and 0 for warnings only.

| Check | Level |
|---|---|
| The file parses and the outline reads | error |
| `run.*` calls: unknown method or keyword argument | error |
| `budget=` is money text such as `"$0.50"` | error |
| The agent named in `run.agent` exists for the folder (the message lists the known ones) | error |
| `schedule(...)` and `on_file(...)` are valid, with the same parser routines use | error |
| A model name that is not set up on this machine | warning: the step would stop with that reason; the run is not refused |
| A model name that is hosted, in a local-only folder | warning: a run would stop at that step |
| An old wish word (when golem has a default model) | warning: it still works; a model name is suggested |
| A wish that does not resolve with your models | warning |

The editor uses the same check while you type (`workflow.check` with the text), and saves with `workflow.save`. A save is refused when the text has an error, when the file changed on disk since you opened it, and for a folder that is not trusted.

The selected step has fields: brief, agent, model (a model you have set up), budget and key. `workflow.edit_step` with the step id `@workflow` sets `model=` on the decorator. Changing one calls `workflow.edit_step`, which replaces exactly that argument in the text (or adds `name=value` when the call lacks it) and leaves comments and formatting alone. It returns the new text, its outline and its problems, and writes nothing: the editor keeps the text as an unsaved edit until you save. A value the code computes (a name, a call, an f-string with expressions) is shown as its source and is set in code; a code step has no fields.

## Ask golem

In the editor, the **ask golem** box (⌘K) under the code takes one sentence: "make it cheaper", "add a step after 2", "run the tests as a separate step". golem makes **one** model call and answers with a proposal. Nothing is written.

- The call goes through the same routing as the chat, for the workflow's folder. A local-only folder uses a local model only. It takes a background slot like a title or a summary does, and its cost is counted against your budget caps.
- The model sees the `run.*` methods, the agents known in that folder, the current code and your sentence. It answers with the whole new file and one or two sentences on what changed and why.
- The answer goes through [Check](#check) before you see it. The outline marks new steps as **new** and changed ones as **changed**, the code pane shows a line diff, and the check result is for the proposal.
- **Accept** puts the proposed code in the editor as an unsaved edit; **Save** then writes it, as for any edit. **Discard** drops it. **Refine…** takes one more sentence on top of the proposal.
- A question ("explain this workflow") comes back as a note with the file unchanged.

The call is `workflow.propose` with the text, the ask and, for a refine, the last proposal and its note. It fails with a clear message when no model is available for the folder.

## Coming next

| Piece | What it adds | Ticket |
|---|---|---|
| Workflows page | List workflows and see each run's steps in the web UI | 3.9 (#741) |
| Editor | Edit a workflow, check it without a model, and try it from a step | 3.11 (#1225) |

Until these land, a workflow can run code, run steps in parallel, save results, use `key=`, ask a model one question, tell you things, ask an agent, run a skill, call a tool and wait for your review.
