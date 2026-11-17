import { Link } from "../../ui/link.tsx";
import { useNavigate, useRoute } from "../../store/page-context.tsx";
import { PaletteHost } from "../palette/index.ts";
import { MenuBar, SidebarShell } from "../sidebar/index.ts";
import { RoutineScreen, RoutinesScreen } from "../routines/index.ts";
import { SettingsScreen } from "../settings/index.ts";
import { TraceScreen } from "../trace/index.ts";
import { SetupAtStart, WelcomeScreen } from "../welcome/index.ts";
import { HomeScreen } from "./home-screen.tsx";
import { ChatView, SessionFrame } from "./session-screen.tsx";

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
    case "trace":
      // Both views of a session sit in one frame at one place in the tree, so the top bar, the
      // drawer, and the model dialog stay as they are when the tab changes. The key gives each
      // session its own state, so the folder is remembered per opening.
      return (
        <SessionFrame key={route.id} id={route.id}>
          {route.name === "session" ? <ChatView id={route.id} /> : <TraceScreen id={route.id} span={route.span} />}
        </SessionFrame>
      );
    case "settings":
      return <SettingsScreen section={route.section} />;
    case "routines":
      return <RoutinesScreen />;
    case "routine":
      return <RoutineScreen name={route.routine} folder={route.folder} />;
    case "welcome":
      return <WelcomeScreen step={route.step} from={route.from} />;
    case "not-found":
      return <NotFoundScreen />;
  }
}

/** The connected page: the sidebar (not on the welcome page), and the main area for the route. */
export function Shell() {
  // The welcome page has no sidebar: it is laid out like home, on its own.
  const route = useRoute().name;
  const welcome = route === "welcome";
  // A session has its own top bar, with the ☰ in it; the other pages get a slim one when the window is narrow.
  const ownBar = route === "session" || route === "trace";
  return (
    <div className="flex h-dvh bg-bg text-ink">
      {welcome ? null : <SidebarShell />}
      <main className="flex min-w-0 flex-1 flex-col">
        {welcome || ownBar ? null : <MenuBar />}
        <Content />
      </main>
      <PaletteHost />
      <SetupAtStart />
    </div>
  );
}
