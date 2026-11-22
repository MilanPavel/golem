import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeSwitch } from "../../theme-switch.tsx";
import { settingsPath } from "../../store/router.ts";
import { installOffer } from "../../store/app-install.ts";
import { useAppInstall, useNavigate } from "../../store/page-context.tsx";
import { Link } from "../../ui/link.tsx";
import { ChatSection } from "./chat-section.tsx";
import { ConfigSection } from "./config-section.tsx";
import { ContextSection } from "./context-section.tsx";
import { useSettingsBack } from "./context.ts";
import { DevicesSection } from "./devices-section.tsx";
import { ModelsSection } from "./models/models-section.tsx";
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

/** Appearance used to hold the chat detail row; this line says where it went. */
function ChatMoved() {
  const navigate = useNavigate();
  return (
    <p className="text-sm text-muted">
      <Link href={settingsPath("chat")} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
        How much a chat shows moved to Chat.
      </Link>
    </p>
  );
}

function Body({ section }: { section: string }) {
  switch (section) {
    case "info":
      return <SetupSection />;
    case "chat":
      return <ChatSection />;
    case "mcp":
      return <McpSection />;
    case "devices":
      return <DevicesSection />;
    case "skills":
      return <SkillsSection />;
    case "agents":
      return <AgentsSection />;
    case "memory":
      return <MemorySection />;
    case "models":
      return <ModelsSection />;
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
          <ChatMoved />
          <AppearanceApp />
        </div>
      );
    default:
      return null;
  }
}

/**
 * The settings page: a sidebar of the sections under their groups (a picker under `md`), and the
 * section beside it with a head (title, description) and its body. Back goes to the
 * session the person came from, else home; so does Esc.
 */
export function SettingsScreen({ section }: { section: string }) {
  const navigate = useNavigate();
  const back = useSettingsBack();
  const current = SECTIONS.find((item) => item.id === section);
  const goBack = useCallback(() => {
    navigate(back.path);
  }, [navigate, back.path]);
  const backTarget = { where: back.where, onBack: goBack };
  // Esc is Back, unless the key belongs to a field or a dialog. Focus on the rail counts too: it stays on the gear after a click.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='alertdialog']") != null) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']") !== null) return;
      event.preventDefault();
      goBack();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [goBack]);
  // `/settings/keys` is the old name of Models, as `/settings/setup` is of Info: the router reads both, and the address follows.
  useEffect(() => {
    if (section === "models" && location.pathname === "/settings/keys") navigate(settingsPath("models"), { replace: true });
  }, [section, navigate]);
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
        back={backTarget}
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
      <SettingsPicker section={section} current={current} back={backTarget} onNavigate={navigate} />
      {/* `relative`: a visually hidden input is positioned against it, so it scrolls with it and cannot make the window taller. */}
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-5">
        {current === undefined ? (
          <>
            <p>There is no such section.</p>
            <Link href={settingsPath()} onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
              Go to Settings
            </Link>
          </>
        ) : (
          <>
            <header className="flex max-w-column flex-col gap-1.5">
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
