import path from "node:path";
import { fileURLToPath } from "node:url";

import { render } from "ink";

import { connectGolem, readStartError, resolveSocketPath } from "@golem/client/node";

import { App } from "./app.tsx";
import { bindPointer } from "./screen.ts";
import type { ServiceControl } from "./service.ts";
import { clearProgress, clearTabStatus, popWindowTitle, pushWindowTitle } from "./window-title.ts";

export type { ServiceControl };

/** On its own the screen can say why the daemon did not start, but not restart it. */
const READ_ONLY_SERVICE: ServiceControl = { startError: readStartError, installed: () => false, restart: null };

/** Open the chat screen. Returns when the screen exits. */
export async function runTui(options: { service?: ServiceControl } = {}): Promise<void> {
  const client = connectGolem({
    socketPath: resolveSocketPath(),
    clientName: "tui",
    reconnect: true,
  });

  const pointer = bindPointer(
    process.stdin,
    (data) => {
      try {
        process.stdout.write(data);
      } catch {
        // The terminal is already gone.
      }
    },
    process.stdout.isTTY === true,
  );
  pushWindowTitle();
  let titleRestored = false;
  const restoreTitle = (): void => {
    if (titleRestored) {
      return;
    }
    titleRestored = true;
    clearProgress();
    clearTabStatus();
    popWindowTitle();
  };
  process.on("exit", pointer.restore);
  process.on("exit", restoreTitle);

  try {
    const instance = render(<App
        client={client}
        onWheel={pointer.subscribe}
        onPointer={pointer.subscribePointer}
        service={options.service ?? READ_ONLY_SERVICE}
      />, {
      stdin: pointer.stdin,
      alternateScreen: true,
      exitOnCtrlC: false,
      // Shift-Enter is otherwise the same byte as Enter. Terminals that answer the query send it apart.
      kittyKeyboard: { mode: "auto" },
    });
    await instance.waitUntilExit();
  } finally {
    process.off("exit", pointer.restore);
    process.off("exit", restoreTitle);
    pointer.restore();
    restoreTitle();
    client.close();
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || entry.length === 0) {
    return false;
  }
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  await runTui();
}
