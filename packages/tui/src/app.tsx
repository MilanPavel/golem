import { useEffect, useState } from "react";
import { Text } from "ink";

import type { ConnectionState, GolemClient } from "@golem/client";

import { statusLabel } from "./status-label.ts";

export function App({ client }: { client: GolemClient }) {
  const [state, setState] = useState<ConnectionState>(client.state);

  useEffect(() => {
    setState(client.state);
    return client.onState(setState);
  }, [client]);

  return <Text color={colorFor(state)}>{statusLabel(state)}</Text>;
}

function colorFor(state: ConnectionState): "green" | "yellow" | "red" {
  if (state.status === "connected") {
    return "green";
  }
  if (state.status === "connecting" || state.status === "reconnecting") {
    return "yellow";
  }
  return "red";
}
