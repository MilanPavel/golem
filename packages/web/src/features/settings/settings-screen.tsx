import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeSwitch } from "../../theme-switch.tsx";
import { sessionPath, settingsPath } from "../../store/router.ts";
import { installOffer } from "../../store/app-install.ts";
import { useConnection } from "../../store/connection-context.tsx";
import { useAppInstall, useNavigate } from "../../store/page-context.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { ConfigSection } from "./config-section.tsx";
import { ContextSection } from "./context-section.tsx";
import { useSettingsContext } from "./context.ts";
import { KeysSection } from "./keys-section.tsx";
import { McpSection } from "./mcp-section.tsx";
import { MemorySection } from "./memory/memory-section.tsx";
import { NotificationsSection } from "./notifications-section.tsx";
import { RoutingSection } from "./routing-section.tsx";
import { RulesSection } from "./rules-section.tsx";
import { SECTIONS } from "./sections.ts";
import { SettingsNav, SettingsPicker } from "./settings-nav.tsx";
import { searchSettings, useSettingJump, type SettingsMatch } from "./settings-search.ts";
import { SettingsSearchBox, SettingsSearchResults } from "./settings-search.tsx";
import { UsageSection } from "./usage-section.tsx";
import { SkillsSection } from "./skills-section.tsx";
import { AgentsSection } from "./agents-section.tsx";
import { DetailSwitch } from "../chat/index.ts";
import { AppCard } from "../setup/index.ts";
import { SetupSection } from "./setup-section.tsx";

/** The `App` block: the same install action as Ready, for later. */
function AppearanceApp() {
  const appInstall = useAppInstall();
  return (
    <AppCard
      offer={installOffer(appInstall.snapshot)}
      host={location.host}
      where="settings"
      onInstall={() => void appInstall.install()}
    />
  );
}

function Body({ section }: { section: string }) {
  switch (section) {
    case "info":
      return <SetupSection />;
    case "mcp":
      return <McpSection />;
    case "skills":
      return <SkillsSection />;
    case "agents":
      return <AgentsSection />;
    case "memory":
      return <MemorySection />;
    case "keys":
      return <KeysSection />;
    case "routing":
      return <RoutingSection />;
    case "context":
      return <ContextSection />;
    case "usage":
      return <UsageSection />;
    case "rules":
      return <RulesSection />;
    case "notifications":
      return <NotificationsSection />;
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
 * The settings page: a sidebar of the sections under their groups (a picker under `md`), and the
 * section beside it with a head (title, description) and its body. Close goes back to the
 * session the person came from, else home.
 */
export function SettingsScreen({ section }: { section: string }) {
  const navigate = useNavigate();
  const context = useSettingsContext();
  const version = useConnection().daemonVersion;
  const current = SECTIONS.find((item) => item.id === section);
  const back = context === null ? "/" : sessionPath(context.sessionId);
  // `/settings/setup` is the old name of Info: the router reads it as Info, and the address follows.
  useEffect(() => {
    if (section === "info" && location.pathname === "/settings/setup") navigate(settingsPath("info"), { replace: true });
  }, [section, navigate]);
  const [query, setQuery] = useState("");
  const [jump, setJump] = useState<{ section: string; keyword: string } | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const matches = searchSettings(query);
  const finishJump = useCallback(() => {
    setJump(null);
  }, []);
  useSettingJump(jump, section, finishJump);
  // Opening a result leaves the search, and a keyword result then goes to its row.
  const open = (match: SettingsMatch | null, href: string) => {
    setQuery("");
    setJump(match?.keyword == null ? null : { section: match.section.id, keyword: match.keyword });
    navigate(href);
  };
  return (
    <div data-screen="settings" className="flex min-h-0 flex-1 flex-col md:flex-row">
      <SettingsNav
        section={section}
        version={version}
        onNavigate={navigate}
        search={
          <SettingsSearchBox
            value={query}
            inputRef={searchBox}
            onChange={setQuery}
            onEnter={() => {
              const first = matches[0];
              if (first !== undefined) open(first, settingsPath(first.section.id));
            }}
          />
        }
        results={query.trim() === "" ? undefined : <SettingsSearchResults query={query} matches={matches} section={section} onPick={open} />}
      />
      <SettingsPicker section={section} current={current} onNavigate={navigate} />
      {/* `relative`: the close button sits in the corner of this pane, and a visually hidden input is positioned against it, so it scrolls with it and cannot make the window taller. */}
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-5">
        <div className="absolute top-4 right-4">
          <IconButton
            label="Close settings"
            onClick={() => {
              navigate(back);
            }}
          >
            <CloseIcon />
          </IconButton>
        </div>
        {current === undefined ? (
          <>
            <p>There is no such section.</p>
            <Link href={settingsPath()} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
              Go to Settings
            </Link>
          </>
        ) : (
          <>
            <header className="flex max-w-column flex-col gap-1.5 pr-10">
              <h2 className="text-title font-semibold tracking-tight">{current.title}</h2>
              <p className="text-body text-muted">{current.description}</p>
            </header>
            <div className="flex min-h-0 flex-1 flex-col">
              <Body section={current.id} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
