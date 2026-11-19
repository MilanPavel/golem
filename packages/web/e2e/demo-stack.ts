// Starts the stack for the terminal demo (`just demo-tui`): the scripted fake model, a daemon on
// a temp home, and the demo project. It writes an env file VHS sources, then waits for SIGTERM
// and stops everything. Run with node, from packages/web: node e2e/demo-stack.ts <env-file>

import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DEMO_VERSION,
  RECEIPTS_ROUTINE,
  RUST_TITLE,
  cargoEnv,
  demoConfig,
  dropReceipt,
  queueReceipts,
  queueRust,
  routineConfig,
  runMorningBrief,
  startDemoDaemon,
  titleRun,
  writeRustProject,
} from "./demo-scenario.ts";
import { startFakeModel } from "./fake-model.ts";
import { REPO, Rig, startSecondClient, writeConfig } from "./harness.ts";

const envFile = process.argv[2];
if (envFile === undefined) {
  process.stderr.write("usage: node e2e/demo-stack.ts <env-file>\n");
  process.exit(2);
}

const rig = new Rig();
const model = rig.own(await startFakeModel());
const home = rig.home();
// The recording's shell gets this as HOME, so the TUI shows the folder as ~/rust-hello.
const fakeHome = realpathSync(rig.home());
const watched = path.join(fakeHome, "Receipts");
const work = path.join(fakeHome, "work");
mkdirSync(watched, { recursive: true });
mkdirSync(work, { recursive: true });
writeConfig(home, demoConfig(model, "qwen3-coder:30b", routineConfig(watched, work)));

rig.own(await startDemoDaemon(home, { env: cargoEnv() }));
const second = rig.own(await startSecondClient(home));
const project = writeRustProject(path.join(fakeHome, "rust-hello"));

// A past run for /runs, then the story: the Rust project in the terminal. When its answer has
// begun, a receipt lands in the watched folder, and its routine waits for you in another session.
await runMorningBrief(model, second);
const asked = model.requests.length;
queueRust(model, 35);
queueReceipts(model);
// `golem tui` makes the session itself, so it is titled once it exists, as the title model would.
const naming = setInterval(() => {
  void second.client.listSessions(20, project).then(async ({ sessions }) => {
    const mine = sessions.find((x) => x.title !== RUST_TITLE);
    if (mine === undefined) return;
    clearInterval(naming);
    await second.client.renameSession(mine.session_id, RUST_TITLE);
  });
}, 100);
const STORY_REQUESTS = 4;
const poll = setInterval(() => {
  if (model.requests.length < asked + STORY_REQUESTS) return;
  clearInterval(poll);
  setTimeout(() => {
    dropReceipt(watched);
    void titleRun(second, RECEIPTS_ROUTINE, "Receipts to CSV");
  }, 800);
}, 200);

// `golem` in the recording is this checkout's CLI, on the temp home, with the demo's version.
const bin = path.join(home, "bin");
const golem = path.join(bin, "golem");
mkdirSync(bin, { recursive: true });
writeFileSync(golem, `#!/bin/sh\nexec bun --define 'GOLEM_VERSION="${DEMO_VERSION}"' "${path.join(REPO, "packages/cli/src/main.ts")}" "$@"\n`);
chmodSync(golem, 0o755);
writeFileSync(envFile, `export GOLEM_HOME="${home}"\nexport PATH="${bin}:$PATH"\nexport HOME="${fakeHome}"\ncd "${project}"\n`);
process.stdout.write(`ready ${home}\n`);

const stop = async (): Promise<void> => {
  await rig.cleanup();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
setInterval(() => undefined, 60_000);
