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
| Routine | A trigger: a time or a new file | `[[routine]]` in `config.toml` |
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

from golem.workflow import Run, manual, workflow


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


@workflow(trigger=manual(), inputs={"folder": str}, description="Count lines in three Markdown files.")
async def hello(run: Run) -> None:
    files = await run.step("find files", find_files, run.inputs["folder"])
    counts = await run.parallel([run.step(f"count {Path(f).name}", count_lines, f) for f in files])
    await run.step("add up", add_up, counts)
```

| Part | What it does |
|---|---|
| `@workflow(trigger=, inputs=)` | Marks the function as a workflow. `manual()` means it starts only when you ask |
| `run.inputs` | The values you pass with `--input` |
| `run.step(name, fn, *args)` | Runs `fn` once and saves its result under `name` |
| `run.parallel([...])` | Runs the steps at the same time and returns their results in order |

To try it, copy the file into your workflows folder:

```bash
cp examples/workflows/hello.py ~/.golem/workflows/
```

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

## Broken and untrusted files

| Case | What you see | What runs |
|---|---|---|
| The file fails to import, or has a syntax error | `golem workflow list` shows it as **broken**, with the traceback | Nothing. The rest of the workflows still work |
| The file is in an untrusted project | It is not listed as runnable, and the list says why | Nothing |
| A workflow raises an error | The run is `failed`, with the step that failed | Only that run stops. The daemon keeps going |
| The file calls `sys.exit()`, hangs or crashes on import | The file is **broken** | Import runs in a short-lived subprocess, so the daemon is not affected |

A broken file never disappears from the list. Fix it and it loads again.

## Coming next

| Piece | What it adds | Ticket |
|---|---|---|
| `run.review` | Wait for your answer | 3.4 (#14) |
| `run.agent` | Start a helper for a step, with a brief and a budget | 3.6 (#16) |
| `run.llm`, `run.tool`, `run.skill` | One model call, one tool, or one skill, with no agent loop | 3.8 (#740) |
| Workflows page | List workflows and see each run's steps in the web UI | 3.9 (#741) |
| Editor | Edit a workflow, check it without a model, and try it from a step | 3.11 (#1225) |

Until these land, a workflow can run code, run steps in parallel, save results, use `key=` and tell you things.
