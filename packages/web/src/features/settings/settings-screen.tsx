import { ThemeSwitch } from "../../theme-switch.tsx";
import { sessionPath, settingsPath } from "../../store/router.ts";
import { installOffer } from "../../store/app-install.ts";
import { useAppInstall, useNavigate, usePageHost } from "../../store/page-context.tsx";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { TAB_LOOK } from "../../ui/tabs.tsx";
import { ConfigSection } from "./config-section.tsx";
import { useSettingsContext } from "./context.ts";
import { McpSection } from "./mcp-section.tsx";
import { RulesSection } from "./rules-section.tsx";
import { SECTIONS } from "./sections.ts";
import { DetailSwitch } from "../chat/index.ts";
import { AppCard } from "../setup/index.ts";
import { SetupSection } from "./setup-section.tsx";

const TAB = cn(TAB_LOOK, "shrink-0 whitespace-nowrap aria-[current=page]:border-clay aria-[current=page]:text-ink");

/** The `App` block: the same install action as Ready, for later. */
function AppearanceApp() {
  const pageHost = usePageHost();
  const appInstall = useAppInstall();
  return (
    <AppCard
      offer={installOffer(appInstall.snapshot, pageHost.kept)}
      host={location.host}
      where="settings"
      onInstall={() => void appInstall.install()}
    />
  );
}

function Body({ section }: { section: string }) {
  switch (section) {
    case "setup":
      return <SetupSection />;
    case "mcp":
      return <McpSection />;
    case "rules":
      return <RulesSection />;
    case "config":
      return <ConfigSection />;
    case "appearance":
      return (
        <div className="flex max-w-column flex-col gap-6">
          <ThemeSwitch />
          <DetailSwitch />
          <AppearanceApp />
        </div>
      );
    default:
      return null;
  }
}

/**
 * The settings page: a header with a close button, a row of tabs for the sections, and the
 * section's body below, full width. Close goes back to the session the person came from, else home.
 */
export function SettingsScreen({ section }: { section: string }) {
  const navigate = useNavigate();
  const context = useSettingsContext();
  const current = SECTIONS.find((item) => item.id === section);
  const back = context === null ? "/" : sessionPath(context.sessionId);
  return (
    <div data-screen="settings" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 px-7 pt-5">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Settings</h1>
        <IconButton
          label="Close settings"
          onClick={() => {
            navigate(back);
          }}
        >
          <CloseIcon />
        </IconButton>
      </header>
      <nav aria-label="Settings sections" className="mt-3 flex gap-1 overflow-x-auto border-b border-line px-7">
        {SECTIONS.map((item) => (
          <Link
            key={item.id}
            href={settingsPath(item.id)}
            onNavigate={navigate}
            aria-current={item.id === section ? "page" : undefined}
            className={TAB}
          >
            {item.title}
          </Link>
        ))}
      </nav>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-5">
        {current === undefined ? (
          <>
            <p>There is no such section.</p>
            <Link href={settingsPath()} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
              Go to Settings
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold tracking-tight">{current.title}</h2>
            <div className="flex min-h-0 flex-1 flex-col">
              <Body section={current.id} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
