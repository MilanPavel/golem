// The stories the demo recordings tell (`just demo-web`, `just demo-tui`). Each one is a script
// for the scripted fake model, so every take is the same, plus the files it works on. The daemon,
// the tools, the routines and the approvals are real.
//
//   search  a question, one web_search, three web_fetch calls, an answer with source chips
//   rust    a hello world project in Rust, with a test, written and run after you allow each step
//   inbox   a file-watch routine that needs an approval while you are in another session
//
// The fake model's queue is global, so a clip queues its replies in the order the daemon asks.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SecondClient } from "./harness.ts";
import type { FakeModel } from "./fake-model.ts";
import { REPO, startDaemon, type Daemon } from "./harness.ts";

/** The version every recording shows, for the TUI and for the daemon: the latest release. */
export const DEMO_VERSION = "0.16.0";

/**
 * Starts the daemon reporting DEMO_VERSION. It reads its version from golem/_build.py once, at
 * start, as a release build does (scripts/dist.sh); the file is gone again once it is up.
 * `cannedWeb` starts it through e2e/demo_daemon.py, which answers web_search and web_fetch from
 * memory instead of the network. Either way the daemon is the real one.
 */
export async function startDemoDaemon(home: string, options: { cannedWeb?: boolean; env?: Record<string, string> } = {}): Promise<Daemon> {
  const build = path.join(REPO, "packages/daemon/golem/_build.py");
  writeFileSync(build, `VERSION = "${DEMO_VERSION}"\n`);
  try {
    return await startDaemon(home, {
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cannedWeb === true ? { command: ["python", path.join(REPO, "packages/web/e2e/demo_daemon.py")] } : {}),
    });
  } finally {
    rmSync(build, { force: true });
  }
}

/**
 * The config for the scripted model, named as the local model the story stands for. A profile
 * named like a ref (provider/name) makes the header show the model's name alone.
 */
export function demoConfig(model: Pick<FakeModel, "baseUrl">, name = "qwen3:30b", extra: string[] = []): string[] {
  return [
    "session_titles = false",
    `model_profile = "openai_compat/${name}"`,
    'model_provider = "openai_compat"',
    `model_name = "${name}"`,
    `model_base_url = "${model.baseUrl}"`,
    ...extra,
  ];
}

// ---------------------------------------------------------------------------------------------
// search

export const SEARCH_ASK = "Tell me something about infinity and great sources I can study.";
const SEP = "https://plato.stanford.edu/entries/infinity/";
const DELFT = "https://ocw.tudelft.nl/courses/infinity-and-the-foundations-of-mathematics/";
const HALMOS = "https://archive.org/details/halmos-naive-set-theory";

/** One search, three pages read, and an answer that cites each of them. The fourth hit is not read. */
export function queueSearch(model: FakeModel, delayMs = 30): void {
  model.toolCall("web_search", { query: "infinity mathematics philosophy introduction sources" }, { delayMs });
  model.toolCall("web_fetch", { url: SEP }, { delayMs });
  model.toolCall("web_fetch", { url: DELFT }, { delayMs });
  model.toolCall("web_fetch", { url: HALMOS }, { delayMs });
  model.reply(
    `Infinity is not one idea: it is endless processes, limits, and the size of infinite sets. [plato.stanford.edu](${SEP})\n\n` +
      `The even numbers can be paired with all the whole numbers, so they are just as many. The real numbers cannot be listed at all, ` +
      `so there are different sizes of infinity. [plato.stanford.edu](${SEP})\n\n` +
      `Good sources, in order:\n\n` +
      `1. **Overview:** the Stanford Encyclopedia entry, [plato.stanford.edu](${SEP}).\n` +
      `2. **Lecture:** Hilbert's hotel and the diagonal argument, [Infinity lecture](${DELFT}).\n` +
      `3. **Book:** Halmos, *Naive Set Theory*, a short and readable start, [Naive Set Theory](${HALMOS}).`,
    { delayMs },
  );
}

// ---------------------------------------------------------------------------------------------
// rust

export const RUST_ASK_WEB = "Make a hello world app in Rust in rust-hello, with a test, and run it.";
export const RUST_ASK_TUI = "Make a hello world app in Rust, with a test, and run it.";
export const RUST_COMMAND = "cargo test && cargo run";

const CARGO_TOML = `[package]
name = "rust-hello"
version = "0.1.0"
edition = "2021"

[dependencies]
`;

const MAIN_RS = `fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}

fn main() {
    println!("{}", greet("world"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greets_by_name() {
        assert_eq!(greet("world"), "Hello, world!");
    }
}
`;

/**
 * An empty git project that ignores target/, so the Changes list shows only what golem wrote.
 * Cargo.lock is ignored too: cargo makes it, golem does not write it, and the story is two files.
 */
export function writeRustProject(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, ".gitignore"), "target/\nCargo.lock\n");
  const git = (...args: string[]): void => {
    execFileSync("git", ["-c", "user.name=demo", "-c", "user.email=demo@example.com", ...args], { cwd: dir, stdio: "ignore" });
  };
  git("init", "-q", "-b", "main");
  git("add", ".gitignore");
  git("commit", "-q", "-m", "Start the project");
  return dir;
}

/** What the daemon's shell needs to find cargo and its toolchain, even when HOME is not the real one. */
export function cargoEnv(): Record<string, string> {
  const real = os.userInfo().homedir;
  return {
    PATH: `${path.join(real, ".cargo/bin")}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
    CARGO_HOME: path.join(real, ".cargo"),
    RUSTUP_HOME: path.join(real, ".rustup"),
  };
}

/** Write the two files, run the test and the program, and say what happened. */
export function queueRust(model: FakeModel, delayMs = 45): void {
  model.toolCall("write_file", { path: "Cargo.toml", content: CARGO_TOML }, { delayMs });
  model.toolCall("write_file", { path: "src/main.rs", content: MAIN_RS }, { delayMs });
  model.toolCall("shell", { command: RUST_COMMAND }, { delayMs });
  model.reply(
    "Done. rust-hello/ has the manifest, a `greet` function and a test. `cargo test` passes and `cargo run` prints Hello, world!",
    { delayMs },
  );
}

// ---------------------------------------------------------------------------------------------
// inbox: routines

export const RECEIPTS_ROUTINE = "receipts-to-csv";
export const BRIEF_ROUTINE = "morning-brief";
const RECEIPTS_CSV = "date,vendor,amount\n2026-11-18,Bakery,12.40\n";

/** The `[[routine]]` tables: a file-watch routine on `watchDir` and a scheduled one. */
export function routineConfig(watchDir: string, briefDir: string): string[] {
  return [
    "",
    "[[routine]]",
    `name = "${RECEIPTS_ROUTINE}"`,
    `on = { watch = "${watchDir}", glob = "*.pdf" }`,
    'prompt = "A receipt arrived: {name}. Add a row for it to receipts.csv."',
    `folder = "${watchDir}"`,
    "",
    "[[routine]]",
    `name = "${BRIEF_ROUTINE}"`,
    'schedule = "weekdays 08:00"',
    'prompt = "Summarize my calendar and the open pull requests for today."',
    `folder = "${briefDir}"`,
  ];
}

/** Fires the scheduled routine once and waits until it has finished, so Runs has a past run. */
export async function runMorningBrief(model: FakeModel, second: SecondClient): Promise<void> {
  model.reply("Two meetings today, at 10:00 and 14:30, and one pull request waits for your review.", { delayMs: 20 });
  const { session_id: id } = await second.client.runRoutine(BRIEF_ROUTINE);
  const end = Date.now() + 30_000;
  for (;;) {
    const { runs } = await second.client.listRuns({ limit: 10 });
    if (runs.some((run) => run.session_id === id && run.status !== "running" && run.status !== "queued")) {
      await second.client.renameSession(id, "Morning brief");
      return;
    }
    if (Date.now() > end) throw new Error("the morning brief did not finish");
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Gives the session of a routine's newest run a title, as the title model would with
 * `session_titles` on (here it is off, so the scripted model's queue is only the story's).
 */
export async function titleRun(second: SecondClient, routine: string, title: string): Promise<void> {
  const end = Date.now() + 30_000;
  for (;;) {
    const { runs } = await second.client.listRuns({ limit: 10 });
    const run = runs.find((r) => r.routine === routine);
    if (run !== undefined) {
      await second.client.renameSession(run.session_id, title);
      return;
    }
    if (Date.now() > end) throw new Error(`no run of ${routine} to title`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** The receipts routine's firing: write the CSV after approval, then say so. */
export function queueReceipts(model: FakeModel, delayMs = 30): void {
  model.toolCall("write_file", { path: "receipts.csv", content: RECEIPTS_CSV }, { delayMs });
  model.reply("Added 1 row to receipts.csv: 2026-11-18, Bakery, 12.40.", { delayMs });
}

/** A small valid PDF, dropped into the watched folder. */
export function dropReceipt(dir: string, name = "bakery-1118.pdf"): void {
  const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
  writeFileSync(path.join(dir, name), pdf);
}
