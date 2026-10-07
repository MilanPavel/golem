#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const child = spawn(
  process.execPath,
  ["--experimental-strip-types", entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
