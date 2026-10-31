import { ThemeSwitch } from "./theme-switch.tsx";

export function App() {
  return (
    <main className="min-h-screen bg-bg p-8 text-ink">
      <h1 className="font-prose text-2xl">golem</h1>
      <p className="mt-2 text-muted">The web UI is being built.</p>
      <ThemeSwitch />
    </main>
  );
}
