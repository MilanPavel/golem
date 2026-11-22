import { useState, type ReactNode } from "react";
import { settingsPath } from "../../store/router.ts";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/icon-button.tsx";
import { ChevronDownIcon, ChevronLeftIcon } from "../../ui/icons.tsx";
import { Link } from "../../ui/link.tsx";
import { GROUPS, SECTIONS, type SettingsSection } from "./sections.ts";
import { useSectionBadges } from "./use-section-badges.ts";

/** The amber count of what needs attention: shows nothing for 0. */
function Badge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span title={`${count} to fix`} className={cn("inline-grid h-4.5 min-w-4.5 place-items-center rounded-full bg-wait-soft px-1.25 text-micro leading-none font-semibold text-wait", className)}>
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
          <span className="block px-2.5 py-1.5 text-meta font-medium text-faint">{group.title}</span>
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

/** The accessible name of Back: "Back to <title>", or "Back to chats" with no session. */
export function backLabel(where: string): string {
  return where === "Chats" ? "Back to chats" : `Back to ${where}`;
}

/**
 * The sidebar of the settings page: the title, a slot for the search box, the sections under their
 * groups. Hidden under `md`.
 */
export function SettingsNav({
  section,
  search,
  results,
  back,
  onNavigate,
}: {
  section: string;
  back: { where: string; onBack: () => void };
  search?: ReactNode;
  /** Shown in place of the grouped list while there is a query. */
  results?: ReactNode;
  onNavigate: (href: string) => void;
}) {
  return (
    <div data-testid="settings-nav" className="hidden min-h-0 w-62 shrink-0 flex-col border-r border-line bg-sunken/50 md:flex">
      <div className="px-4 pt-3 pb-2.5">
        <button
          type="button"
          aria-label={backLabel(back.where)}
          onClick={back.onBack}
          className="mb-2.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-offset-2 outline-clay hover:bg-surface/70 focus-visible:outline-2"
        >
          <ChevronLeftIcon className="shrink-0 text-faint" />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium text-ink">Back</span>
            <span className="truncate text-meta text-muted">{back.where}</span>
          </span>
        </button>
        <h1 className="mb-3.5 ml-1 text-panel font-semibold tracking-tight">Settings</h1>
        {search}
      </div>
      <nav aria-label="Settings sections" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {results ?? <Groups section={section} onNavigate={onNavigate} />}
      </nav>
    </div>
  );
}

/** Under `md`: one button showing the group and section, which opens the same grouped list. */
export function SettingsPicker({
  section,
  current,
  back,
  onNavigate,
}: {
  section: string;
  current: SettingsSection | undefined;
  back: { where: string; onBack: () => void };
  onNavigate: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const group = GROUPS.find((item) => item.id === current?.group);
  const total = Object.values(useSectionBadges()).reduce((sum, count) => sum + count, 0);
  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-3 md:hidden">
      <IconButton label={backLabel(back.where)} className="size-11 shrink-0" onClick={back.onBack}>
        <ChevronLeftIcon />
      </IconButton>
      <div className="min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="settings-picker-list"
        onClick={() => {
          setOpen(!open);
        }}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3 py-2.5 text-left text-sm font-semibold outline-offset-2 outline-clay focus-visible:outline-2"
      >
        {current === undefined ? null : <current.icon className="text-clay" />}
        <span>{current?.title ?? "Settings"}</span>
        {group === undefined ? null : <small className="text-meta font-normal text-faint">{group.title}</small>}
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
    </div>
  );
}
