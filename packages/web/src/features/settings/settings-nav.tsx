import { useState, type ReactNode } from "react";
import { settingsPath } from "../../store/router.ts";
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, SettingsConfigIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { GROUPS, SECTIONS, type SettingsSection } from "./sections.ts";
import { useSectionBadges } from "./use-section-badges.ts";

/** The amber count of what needs attention: shows nothing for 0. */
function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span title={`${count} to fix`} className={cn("inline-grid h-4.5 min-w-4.5 place-items-center rounded-full bg-wait-soft px-1.25 font-mono text-micro leading-none font-bold text-wait", className)}>
      {count}
    </span>
  );
}

const ITEM = cn(
  "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-ink-soft outline-offset-2 outline-clay hover:bg-surface/70 focus-visible:outline-2",
  "[&_svg]:shrink-0 [&_svg]:text-faint",
  "aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-soft aria-[current=page]:ring-1 aria-[current=page]:ring-line",
  "aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 aria-[current=page]:before:-left-2.5 aria-[current=page]:before:w-0.75 aria-[current=page]:before:rounded-r-xs aria-[current=page]:before:bg-clay",
  "aria-[current=page]:[&_svg]:text-clay",
);

/** The groups with their sections as links, in order. */
function Groups({ section, onNavigate, onPick }: { section: string; onNavigate: (href: string) => void; onPick?: () => void }) {
  const badges = useSectionBadges();
  return (
    <>
      {GROUPS.map((group) => (
        <div key={group.id} className="mt-3.5 first:mt-1.5">
          <span className="block px-2.5 py-1.5 font-mono text-micro font-semibold tracking-widest text-faint uppercase">{group.title}</span>
          {SECTIONS.filter((item) => item.group === group.id).map((item) => (
            <Link
              key={item.id}
              href={settingsPath(item.id)}
              onNavigate={(href) => {
                onPick?.();
                onNavigate(href);
              }}
              aria-current={item.id === section ? "page" : undefined}
              className={ITEM}
            >
              <item.icon />
              <span>{item.title}</span>
              <Badge count={badges[item.id] ?? 0} className="ml-auto" />
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * The sidebar of the settings page: the title, a slot for the search box, the sections under their
 * groups, and a footer with the version and a link to the config file. Hidden under `md`.
 */
export function SettingsNav({
  section,
  version,
  search,
  onNavigate,
}: {
  section: string;
  version: string | null;
  search?: ReactNode;
  onNavigate: (href: string) => void;
}) {
  return (
    <div data-testid="settings-nav" className="hidden min-h-0 w-62 shrink-0 flex-col border-r border-line bg-sunken/50 md:flex">
      <div className="px-4 pt-5 pb-2.5">
        <h1 className="mb-3.5 ml-1 font-prose text-2xl leading-none font-normal tracking-tight">Settings</h1>
        {search}
      </div>
      <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <Groups section={section} onNavigate={onNavigate} />
      </nav>
      <div className="flex items-center gap-2 border-t border-line px-4 pt-2.5 pb-3 font-mono text-xs text-faint">
        <span aria-hidden="true" className="size-1.75 rounded-full bg-allow" />
        {version === null ? "golem" : `golem v${version}`}
        <Link
          href={settingsPath("config")}
          onNavigate={onNavigate}
          title="Open config.toml"
          className="ml-auto inline-flex items-center gap-1 outline-offset-2 outline-clay hover:text-clay-ink focus-visible:outline-2"
        >
          <SettingsConfigIcon className="size-3.5" />
          toml
        </Link>
      </div>
    </div>
  );
}

/** Under `md`: one button showing the group and section, which opens the same grouped list. */
export function SettingsPicker({
  section,
  current,
  onNavigate,
}: {
  section: string;
  current: SettingsSection | undefined;
  onNavigate: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const group = GROUPS.find((item) => item.id === current?.group);
  const total = Object.values(useSectionBadges()).reduce((sum, count) => sum + count, 0);
  return (
    <div className="border-b border-line px-4 py-3 md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="settings-picker-list"
        onClick={() => {
          setOpen(!open);
        }}
        className="flex w-full items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3 py-2.5 text-left text-sm font-semibold outline-offset-2 outline-clay focus-visible:outline-2"
      >
        {current === undefined ? null : <current.icon className="text-clay" />}
        <span>{current?.title ?? "Settings"}</span>
        {group === undefined ? null : <small className="font-mono text-micro font-normal text-faint uppercase">{group.title}</small>}
        <Badge count={total} className="ml-auto" />
        <ChevronDownIcon className={cn(total === 0 && "ml-auto", "text-faint", open && "rotate-180")} />
      </button>
      {open ? (
        <div id="settings-picker-list" role="group" aria-label="All settings sections" className="mt-2 flex flex-col">
          <Groups
            section={section}
            onNavigate={onNavigate}
            onPick={() => {
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
