---
title: Checking skill triggering by hand
description: Ten prompts, each with the skill the model should load or none, and how to run them against a real model until the eval harness exists.
---

Whether a model loads the right skill is a property of the model and of the skill index, so a unit test cannot say. Until the skill-trigger eval (step 6.2) exists, run these ten prompts by hand against each model you care about. The list is also the one the next step reuses (2.5.3).

## The prompts

Three skills sit in `scripts/skill-trigger/skills/`: `release-notes`, `commit-message`, and `sql-review`. A fourth, `ship`, has `disable-model-invocation: true`, so it is never in the index and the model must not be able to load it. The prompts are in `scripts/skill-trigger/prompts.json`.

| # | Prompt | Expected skill |
|---|---|---|
| 1 | Write the release notes for 0.4.0: added dark mode, fixed a crash on an empty chat. | `release-notes` |
| 2 | Draft a changelog entry for version 2.1: faster startup, a new /skills command. | `release-notes` |
| 3 | What should the commit message be for a change that renames the config key theme to color_scheme? | `commit-message` |
| 4 | Write a commit message for this: fix an off-by-one error in the pagination. | `commit-message` |
| 5 | Review this query: `SELECT * FROM orders o JOIN customers c ON 1=1 WHERE c.id = o.customer_id` | `sql-review` |
| 6 | Is `SELECT name FROM users WHERE lower(email) = 'a@b.c'` slow on a big table? Review it. | `sql-review` |
| 7 | What is the capital of Australia? | none |
| 8 | Write a Python function that reverses a string. | none |
| 9 | Open a pull request for my changes. | none (`ship` is not offered) |
| 10 | Translate 'good morning' into French. | none |

A pass is a `skill.activated` event with `how: "model"` for the expected skill, and none for a prompt that expects none. The answer's quality is not part of this check.

## Run it

```sh
uv run python scripts/skill_trigger_check.py --model ollama/qwen3.8:27b \
  --skills scripts/skill-trigger/skills/* --prompts scripts/skill-trigger/prompts.json
```

The script starts a daemon on a new home, never `~/.golem`, and an empty project folder. Each prompt gets a new session. It prints one JSON line per prompt with the skill loaded, the tools called, and the start of the answer, and exits with 1 when any prompt failed. `--model` takes a profile or a `provider/model` ref. A remote model needs its key in the keychain, as for `golem`. The script answers no approval, so a run that asks for one is reported as `approval`.

## Results

Recorded on a Mac with the daemon at protocol 2.67. A model run is not repeatable to the token, so read these as a sample.

| Model | Where | Passed | What happened |
|---|---|---|---|
| `qwen3.8:27b` | local, Ollama (MLX) | 10 of 10 | It called `load_skill` for prompts 1 to 6 and answered 7, 8, and 10 without a tool. For 2 it went on to `write_file` and waited for approval, which the script reports as `approval`; the skill had loaded before that. For 9 it looked at the folder instead and did not load `ship` |
| `llama3.2:3b` | local, Ollama | 3 of 10 | Prompts 1 to 6 failed: it wrote `{"name": "release-notes", "parameters": {...}}` as its answer, with the skill's name where the tool's name goes, so no tool ran. Prompt 8 loaded `commit-message` for a Python question. 7, 9, and 10 passed because it loaded nothing |
| a remote model | | not run | See below |

**Not run on a remote model.** No provider key was available in the session that wrote this check. Run the command above with a remote `--model`, such as `anthropic/claude-sonnet-4-5`, and add a row here. Until then the ticket's second half, one remote and one local model, is open.

The small model's failure is the useful part: the index told it to call `load_skill`, but it called the skill by name. That is a model limit, not a bug in the index. A smaller or weaker model may need the pinned skills (`/skill pin`) instead.

## An unchanged Claude Code skill (2.4.4)

The fixture skills above are golem's own. This check uses a skill written for Claude Code, copied untouched: `claude-md-improver` from Anthropic's `claude-md-management` plugin (`claude-plugins-official`). It lives in `~/.claude/skills`, reads `references/quality-criteria.md` and `references/templates.md` through links relative to itself, and is never named in the prompt. It is not copied into this repository.

```sh
uv run python scripts/skill_trigger_check.py --model ollama/qwen3.8:27b \
  --claude-skill <path to>/claude-md-improver \
  --project-file scripts/skill-trigger/claude-code/CLAUDE.md \
  --prompts scripts/skill-trigger/claude-code/prompts.json \
  --config '[permissions]; mode = "autopilot"'
```

The prompt is "Look at the CLAUDE.md in this folder and tell me how good it is, then improve it." The project folder holds one weak `CLAUDE.md`. With `qwen3.8:27b` on a local Ollama, the run was:

| Step | What the model did |
|---|---|
| 1 | `load_skill` with `claude-md-improver`. The log has `skill.activated` with `how: "model"` |
| 2 | `glob`, then `read_file` of `CLAUDE.md` |
| 3 | `read_file` of `quality-criteria.md` and `templates.md`, by absolute path in the skill's folder, which `load_skill` returned |
| 4 | `list_dir` twice and one `shell`, then the quality report: one file, score 5 out of 100, and what to add |

The run ended with `run.completed`. The script keeps only the start of the answer, so whether it then edited the file was not checked. Both reference files were read, which the session could not do before the skill was loaded. `test_a_claude_code_skill_with_relative_links_loads_and_its_file_reads` in `test_skills_load.py` pins the same path with a scripted model, so it is checked on every run too. A remote model was not tried, for the reason above.
