import { tildePath } from "@golem/view";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { SetupStatusResult } from "../../store/models.ts";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { CopyButton } from "../../ui/copy-command.tsx";
import { cn } from "../../ui/cn.ts";
import { PixelGolem } from "../../ui/pixel-golem.tsx";

type Install = NonNullable<SetupStatusResult["install"]>;
type Facts = Pick<SetupStatusResult, "install" | "paths" | "jobs">;

const KIND_WORDS: Record<Install["method"], string> = { homebrew: "homebrew", script: "install script", dev: "dev checkout" };
const TICK_MS = 30_000;

/** `just now`, or how many minutes (then hours) ago the status was read. */
export function checkedAgo(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}

export type HeroCardProps = {
  install: Install | null | undefined;
  /** The version to show when the daemon sent no install facts. */
  fallbackVersion: string;
  /** When the status was read, in ms. */
  checkedAt: number;
  checking: boolean;
  busy: boolean;
  onRunAgain: () => void;
  onCheckAgain: (from: HTMLElement) => void;
};

/** The top of Settings → Info: what is installed and where it runs from, with the two actions for the whole page. */
export function HeroCard({ install, fallbackVersion, checkedAt, checking, busy, onRunAgain, onCheckAgain }: HeroCardProps) {
  const now = useNow();
  const version = (install?.version ?? fallbackVersion).replace(/^v/, "");
  const from = install == null ? null : (install.binary ?? install.daemon_binary);
  return (
    <div
      role="group"
      aria-label="golem"
      data-setting="golem"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line bg-surface p-4"
    >
      <PixelGolem state="idle" size="md" className="shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">golem</h3>
          {version === "" ? null : <Badge className="py-0.5">v{version}</Badge>}
          {install == null ? null : <Badge tone="clay" className="py-0.5">{KIND_WORDS[install.method]}</Badge>}
        </div>
        <p className="min-w-0 text-meta break-all text-muted">
          {from === null ? null : (
            <>
              Running from{" "}
              <Code tone="muted" title={from}>
                {tildePath(from)}
              </Code>{" "}
              ·{" "}
            </>
          )}
          checked {checkedAgo(checkedAt, now)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button kind="ghost" size="sm" onClick={onRunAgain}>
          Run setup again
        </Button>
        <Button
          size="sm"
          disabled={busy}
          aria-busy={checking}
          onClick={(event) => {
            onCheckAgain(event.currentTarget);
          }}
        >
          {checking ? "Checking…" : "Check again"}
        </Button>
      </div>
    </div>
  );
}

function Cell({ setting, label, copy, children }: { setting: string; label: string; copy: string; children: ReactNode }) {
  return (
    <div data-setting={setting} className="flex min-h-9 min-w-0 items-center gap-2 rounded-md border border-line bg-surface px-3 py-1">
      <span className="w-14 shrink-0 text-meta text-faint">{label}</span>
      {children}
      <CopyButton text={copy} label={`${label.toLowerCase()} path`} />
    </div>
  );
}

/** A status tag: a dot and a word in sentence case. */
function Tag({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-meta font-medium", ok ? "text-allow" : "text-wait")}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** The two launchd jobs as one cell: their names, and one tag with the worse state. */
function JobsCell({ jobs }: { jobs: NonNullable<Facts["jobs"]> }) {
  const names = jobs.map((job) => job.label.split(".").at(-1)).join(" · ");
  const detail = jobs.map((job) => `${job.label}${job.pid == null ? "" : ` · pid ${job.pid}`}`).join("\n");
  const loaded = jobs.every((job) => job.loaded);
  return (
    <Cell setting="jobs" label="Jobs" copy={jobs.map((job) => job.plist).join("\n")}>
      <Code title={detail} className="min-w-0 flex-1 truncate text-ink-soft">
        {names}
      </Code>
      <Tag ok={loaded}>{loaded ? "Loaded" : "Not loaded"}</Tag>
    </Cell>
  );
}

function PathCell({ setting, label, full }: { setting: string; label: string; full: string }) {
  return (
    <Cell setting={setting} label={label} copy={full}>
      <Code title={full} className="min-w-0 flex-1 truncate text-ink-soft">
        {tildePath(full)}
      </Code>
    </Cell>
  );
}

/** Where golem keeps its files and which launchd jobs run it: two columns, one at a narrow width, a Copy on each cell. */
export function PathsGrid({ facts }: { facts: Facts }) {
  const { install, paths } = facts;
  const jobs = facts.jobs ?? [];
  const heading = useId();
  if (!install && !paths && jobs.length === 0) return null;
  return (
    <div role="group" aria-labelledby={heading} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 id={heading} className="text-heading font-semibold">
          Where things live
        </h3>
        <span className="text-meta text-muted">Copy takes the full path</span>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {paths ? <PathCell setting="data" label="Data" full={paths.home} /> : null}
        {install ? <PathCell setting="daemon" label="Daemon" full={install.daemon_binary} /> : null}
        {paths ? <PathCell setting="config" label="Config" full={paths.config} /> : null}
        {paths ? <PathCell setting="socket" label="Socket" full={paths.socket} /> : null}
        {paths ? <PathCell setting="logs" label="Logs" full={paths.logs} /> : null}
        {jobs.length === 0 ? null : <JobsCell jobs={jobs} />}
      </div>
    </div>
  );
}
