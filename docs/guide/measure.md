---
title: Measure
description: What the four helper numbers mean, and how to measure them on your own Mac from the web page, the terminal UI or the command line.
---

# Measure

golem suggests a helper to the model by four numbers. They are a first guess. **Measure** plays the same fixed asks with helpers off and on, on your own Mac and your own models, and proposes better ones. This page is about the numbers and the measurement. For what a helper is and when golem starts one, read [Helpers](./helpers.md).

## The four numbers

Each number is a share of the window or a price ratio, never a count of tokens, so one setting fits a 32K local model and a 1M cloud one.

| Number | Default | Means |
|---|---|---|
| `read_share` | 30% | A job that reads more than this share of the window crowds out the task |
| `fill_share` | 85% | The share the window would reach with the reading added. Past it the reading does not fit |
| `job_share` | 10% | The least a job reads, as a share of the window, to be worth its own helper |
| `price_ratio` | 3× | How many times dearer your model must be than the helper's before a large read moves there |

The shares are of the working window, the first 128K of the window (`work_window` in `[agents.delegate]`), so a run's reading share means the same on a 64K and a 1M lead.

The numbers **shape what golem suggests to the model**. They do not decide whether a helper may run. "Use helpers" does that: with Never the model is not offered helpers at all, and with Ask me first every helper waits for your yes. The line under the tiles says where the numbers come from: "FIRST GUESS" (the ones golem ships, not measured), "CHANGED" (set in your config or by a measurement) or "MEASURED on a date with a model".

## Measure

A measurement plays the same fixed asks twice, once with helpers off and once with them on, and compares the quality, the time and how much of the window was left. From that it proposes the four numbers. It runs in the golem service, so you can leave the page, close it or use another client. It does not stop.

You can start one from three places. They are the same measurement, so one started in one place shows in the others.

- **On the page.** Settings › Agents › Measure lists the arms with the memory each needs. Tick the ones you want and press **Start**. The page shows the run, the memory and the runs so far, with **Stop**. The Measure tab shows a dot while one runs.
- **In the terminal UI.** `/agents`, then `m`.
- **On the command line.** `golem eval helpers` with no arm prints the plan and starts nothing. `golem eval helpers --arm local-32k` starts it and prints a line for each run. See [Commands](./commands.md).

An **arm** is a model with a window size, such as "Local, 32K window" or "Budget cloud". A local arm uses a model on this Mac through Ollama. A cloud arm uses a paid model.

### Memory rules

A local model that does not fit can make the Mac stop answering, so golem checks memory before it starts and warns you. It warns; it does not forbid. The choice is yours.

- **Fits.** Nothing to tick.
- **Tight** (it fits, but takes more than half of the memory) starts after you tick "I saved my work. Run although memory is tight." On the command line add `--allow-tight`.
- **Too big** (the model and its window need more than this Mac has), **no room** (not enough memory is free now) and **not known** (the memory could not be read) show a warning, and you can still run them at your own risk. Tick "I saved my work. Run at my own risk: this can make the Mac stop answering." On the command line add `--own-risk`. golem notes in the measurement that it was started at your own risk.
- A model that Ollama already holds in memory is not counted as missing memory. Only the memory still to load is checked against the free memory, so the second half of a measurement is not refused because the model is loaded.
- Only an arm with nothing to run cannot be started: a model that is not installed, or a paid model without a key.
- One model and one request run at a time.
- Even at your own risk, the run stops by itself when the free memory gets very low (below about 1.5 GB), or when the model server stops answering. It says why. This is the one stop that stays, to keep the Mac answering.
- A stopped run can be **continued**. It plays only the runs that did not run, and it asks the same memory question again: the same warning and the same box. Stopped runs are kept, and a run that did not play is never counted.

### What is asked

Every measurement plays the same fixed asks. You can read them before anything starts and see them again after a run.

- **Before a start.** On the Measure tab, under **New measurement**, open **See the N asks**. In the terminal UI press `a` on the list. On the command line run `golem eval helpers asks`.
- **For each ask** you see the message sent to the model, what the answer must mention, what the ask is set up with (for example "6 small files" or "24 modules of 60 lines") and why it is in the set: a plain ask, a large reading that can crowd the window, independent jobs, or a question a stronger or cheaper model may fit better.
- **After a run.** Each row of the runs table opens to the message, the facts the answer was checked for (marked found or missing) and the model's answer, kept up to 2,000 characters. The **Answer** column is the share of those facts found, from 0 to 1. In the terminal UI press `a` on a measurement to list its runs and `o` to open one. On the command line `golem eval helpers show <id> --verbose` prints every run, and `--ask <name>` prints the runs of one ask.
- **Parameters.** Above the table, **Parameters** lists for each arm the model, the window in tokens, that one request runs at a time, which model helpers use, the four helper rules in force when it started, and the golem version. It also says when the measurement was started at your own risk.

A measurement kept before this was added shows the asks as they are now, and no answers.

### Paid arms

A cloud arm costs money. The plan shows an estimate for each paid arm before you start, and a paid arm is not ticked at first. golem needs your key for it, and says so when there is none.

### The numbers it proposes

A finished measurement shows each ask with helpers off against on, and the four numbers it proposes next to the ones in use. A number it could not measure says "not measured" and stays as it is.

- **Use these numbers** writes the measured ones to `[agents.delegate]` in `config.toml`, keeps your comments, and opens the Rules tab, which then says "MEASURED". On the command line it is `golem eval helpers apply <id>`.
- **Keep mine and close** writes nothing. You can come back to the measurement later.

The numbers are read-only on the page. To set them by hand, edit `[agents.delegate]` in `config.toml` ([Settings](./settings.md#agentsdelegate)).

### Where measurements are kept

Each measurement is a file in `~/.golem/evals/`, written run by run, so a restart loses nothing. The list on the Measure tab (or `golem eval helpers list`) shows them, newest first, with the one in use marked. **Delete** (or `golem eval helpers delete <id>`) removes one that is not running.
