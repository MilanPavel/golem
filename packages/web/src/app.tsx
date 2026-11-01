import { ConnectionScreen, connectionScreen } from "./features/connection/index.ts";
import { Shell } from "./features/shell/index.ts";
import { useConnection } from "./store/connection-context.tsx";

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
  return <Shell />;
}
