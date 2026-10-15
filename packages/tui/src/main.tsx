import { render } from "ink";

import { connectGolem, resolveSocketPath } from "@golem/client";

import { App } from "./app.tsx";
import { bindPointer } from "./screen.ts";

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
process.on("exit", pointer.restore);

try {
  const instance = render(<App client={client} onWheel={pointer.subscribe} />, {
    stdin: pointer.stdin,
    alternateScreen: true,
    exitOnCtrlC: false,
  });
  await instance.waitUntilExit();
} finally {
  process.off("exit", pointer.restore);
  pointer.restore();
  client.close();
}
