import { Link } from "../../ui/link.tsx";
import { useNavigate, useRoute } from "../../store/page-context.tsx";
import { Sidebar } from "../sessions/index.ts";
import { HomeScreen } from "./home-screen.tsx";
import { SessionScreen } from "./session-screen.tsx";

export function NotFoundScreen() {
  const navigate = useNavigate();
  return (
    <div data-screen="not-found" className="grid min-h-0 flex-1 place-items-center p-5">
      <div className="flex max-w-lg flex-col items-center gap-3 text-center">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Page not found</h1>
        <p className="text-muted">There is nothing at this address.</p>
        <Link href="/" onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
          Go to the start
        </Link>
      </div>
    </div>
  );
}

function Content() {
  const route = useRoute();
  switch (route.name) {
    case "home":
      return <HomeScreen />;
    case "session":
      // The key gives each session its own state, so the folder is remembered per opening.
      return <SessionScreen key={route.id} id={route.id} />;
    case "not-found":
      return <NotFoundScreen />;
  }
}

/** The connected page: the sidebar, and the main area for the route. */
export function Shell() {
  return (
    <div className="flex h-dvh bg-bg text-ink">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Content />
      </main>
    </div>
  );
}
