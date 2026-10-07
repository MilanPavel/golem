import { render } from "ink";

import { connectGolem, resolveSocketPath } from "@golem/client";

import { App } from "./app.tsx";

const client = connectGolem({
  socketPath: resolveSocketPath(),
  clientName: "tui",
  reconnect: true,
});

const instance = render(<App client={client} />);
await instance.waitUntilExit();
client.close();
