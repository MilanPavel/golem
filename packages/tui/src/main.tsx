import { render } from "ink";

import { connectGolem, readStartError, resolveSocketPath } from "@golem/client/node";

import { App } from "./app.tsx";
import { bindPointer } from "./screen.ts";
import type { ServiceControl, WindowDaemon } from "./service.ts";
import { clearProgress, clearTabStatus, popWindowTitle, pushWindowTitle } from "./window-title.ts";

export type { ServiceControl, WindowDaemon };

/** On its own the screen can say why the daemon did not start, but not start or restart it. */
const READ_ONLY_SERVICE: ServiceControl = {
  startError: readStartError,
  installed: () => false,
  agentLoaded: () => false,
  restart: null,
  install: null,
  uninstall: null,
  serve: null,
  windowDaemon: () => null,
  logTail: () => [],
};

/**
 * Open the chat screen. Returns when the screen exits.
 *
 * Importing this module must not open a screen. `golem` imports it and calls
 * `runTui` with the service control, and `bun build --compile` gives every
 * bundled module the binary's own path, so a "was I run directly?" check is
 * true there too and would open a second screen that can't install the
 * service. `dev.tsx` opens it on its own for `just tui`.
 */
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
