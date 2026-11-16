import { useState } from "react";
import { ConnectionScreen, connectionScreen, RESTART_GRACE_MS, useOverdue } from "./features/connection/index.ts";
import { Shell } from "./features/shell/index.ts";
import { DAEMON_DOWN_CLOSE_CODE } from "./store/connection.ts";
import { useConnection } from "./store/connection-context.tsx";
import { usePageHost, useRoute } from "./store/page-context.tsx";

export function App() {
  const connection = useConnection();
  const { kept } = usePageHost();
  // The grace runs while the gateway is down, not while the daemon is: a page host that is down
  // is what a job restarts.
  const down = connection.state.status === "reconnecting" && connection.state.closeCode !== DAEMON_DOWN_CLOSE_CODE;
  const overdue = useOverdue(down, RESTART_GRACE_MS);
  // Once the page has been connected, a link that was just lost keeps the page and shows a strip in
  // the sidebar. After the same grace the screens use, or on any other failure, the whole screen
  // comes with its commands.
  const [wasConnected, setWasConnected] = useState(false);
  if (connection.state.status === "connected" && !wasConnected) setWasConnected(true);
  const reconnecting = connection.state.status === "reconnecting";
  const lostLong = useOverdue(reconnecting, RESTART_GRACE_MS);
  // The welcome page has no panel to hold the strip, so it takes the screen at once.
  const welcome = useRoute().name === "welcome";
  const keepShell = wasConnected && reconnecting && !lostLong && !welcome;
  const screen = keepShell ? null : connectionScreen(connection, { kept, overdue });
  if (screen) {
    return (
      <main className="grid min-h-screen bg-bg text-ink">
        <ConnectionScreen spec={screen} />
      </main>
    );
  }
  return <Shell />;
}
