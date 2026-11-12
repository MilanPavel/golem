import { ConnectionScreen, connectionScreen, RESTART_GRACE_MS, useOverdue } from "./features/connection/index.ts";
import { Shell } from "./features/shell/index.ts";
import { DAEMON_DOWN_CLOSE_CODE } from "./store/connection.ts";
import { useConnection } from "./store/connection-context.tsx";
import { usePageHost } from "./store/page-context.tsx";

export function App() {
  const connection = useConnection();
  const { kept } = usePageHost();
  // The grace runs while the gateway is down, not while the daemon is: a page host that is down
  // is what a job restarts.
  const down = connection.state.status === "reconnecting" && connection.state.closeCode !== DAEMON_DOWN_CLOSE_CODE;
  const overdue = useOverdue(down, RESTART_GRACE_MS);
  const screen = connectionScreen(connection, { kept, overdue });
  if (screen) {
    return (
      <main className="grid min-h-screen bg-bg text-ink">
        <ConnectionScreen spec={screen} />
      </main>
    );
  }
  return <Shell />;
}
