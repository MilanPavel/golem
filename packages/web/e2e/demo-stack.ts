// Starts the stack for the terminal demo (`just demo-tui`): the scripted fake model, a daemon on
// a temp home, and the demo project. It writes an env file VHS sources, then waits for SIGTERM
// and stops everything. Run with node, from packages/web: node e2e/demo-stack.ts <env-file>

import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DEMO_VERSION, demoConfig, queueDemo, startDemoDaemon, writeDemoProject } from "./demo-scenario.ts";
import { startFakeModel } from "./fake-model.ts";
import { REPO, Rig, writeConfig } from "./harness.ts";

const envFile = process.argv[2];
if (envFile === undefined) {
  process.stderr.write("usage: node e2e/demo-stack.ts <env-file>\n");
  process.exit(2);
}

const rig = new Rig();
const model = rig.own(await startFakeModel());
const home = rig.home();
writeConfig(home, demoConfig(model));

rig.own(await startDemoDaemon(home));
// The recording's shell gets this as HOME, so the TUI shows the folder as ~/my-project.
const fakeHome = realpathSync(rig.home());
const project = writeDemoProject(path.join(fakeHome, "my-project"));
queueDemo(model, 35);

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
