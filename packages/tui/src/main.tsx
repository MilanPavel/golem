import { render } from "ink";

import { connectGolem, resolveSocketPath } from "@golem/client";

import { App } from "./app.tsx";
import { bindPointer } from "./screen.ts";
import { popWindowTitle, pushWindowTitle } from "./window-title.ts";

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
  popWindowTitle();
};
process.on("exit", pointer.restore);
process.on("exit", restoreTitle);

try {
  const instance = render(<App client={client} onWheel={pointer.subscribe} />, {
    stdin: pointer.stdin,
    alternateScreen: true,
    exitOnCtrlC: false,
  });
  await instance.waitUntilExit();
} finally {
  process.off("exit", pointer.restore);
  process.off("exit", restoreTitle);
  pointer.restore();
  restoreTitle();
  client.close();
}
