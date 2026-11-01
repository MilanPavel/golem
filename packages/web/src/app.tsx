import { ConnectionLine, ConnectionScreen, connectionScreen } from "./features/connection/index.ts";
import { useConnection } from "./store/connection-context.tsx";
import { ThemeSwitch } from "./theme-switch.tsx";

export function App() {
  const connection = useConnection();
  const screen = connectionScreen(connection);
  if (screen) {
    return (
      <main className="grid min-h-screen bg-bg text-ink">
        <ConnectionScreen spec={screen} />
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-bg p-8 text-ink">
      <h1 className="font-prose text-2xl">golem</h1>
      <p className="mt-2 text-muted">The web UI is being built.</p>
      <div className="mt-4">
        <ConnectionLine snapshot={connection} />
      </div>
      <ThemeSwitch />
    </main>
  );
}
