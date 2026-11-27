import { useId } from "react";
import { DATA_NOT_AVAILABLE, groupSources, sourceDetail } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { Button } from "../../ui/button.tsx";
import { DataSourceIcon } from "../../ui/data-icons.tsx";
import { Link } from "../../ui/link.tsx";
import type { DataAnswer, DataListResult, DataSource } from "../../store/data.ts";
import { dataPath } from "../../store/router.ts";
import { folderName } from "../sessions/folder.ts";
import { PrivacyChip } from "./privacy-chip.tsx";

function SourceRow({ source, selected, onNavigate }: { source: DataSource; selected: boolean; onNavigate: (path: string) => void }) {
  const detail = sourceDetail(source);
  return (
    <li>
      <Link
        href={dataPath(source.name)}
        onNavigate={onNavigate}
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-muted outline-offset-2 outline-clay hover:bg-line hover:text-ink focus-visible:outline-2",
          selected && "bg-surface text-ink ring-1 ring-line ring-inset",
        )}
      >
        <span className="flex items-center gap-2">
          <DataSourceIcon kind={source.kind} location={source.location} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{source.name}</span>
          <PrivacyChip privacy={source.privacy} className="shrink-0 px-2 py-0.5" />
        </span>
        <span className={cn("truncate pl-6 text-xs", source.status === "error" ? "text-deny" : source.status === "untrusted" ? "text-wait" : "text-faint")}>{detail}</span>
      </Link>
    </li>
  );
}

function Group({ label, sources, selected, onNavigate }: { label: string; sources: readonly DataSource[]; selected: string | null; onNavigate: (path: string) => void }) {
  const headingId = useId();
  return (
    <div>
      <div id={headingId} className="mb-1 px-2.5 text-xs font-medium text-faint">
        {label}
      </div>
      <ul aria-labelledby={headingId} className="flex flex-col gap-px">
        {sources.map((source) => (
          <SourceRow key={`${source.scope}/${source.name}`} source={source} selected={selected === source.name} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}

export type DataPanelProps = {
  /** The daemon's answer, or null while it has not come. */
  answer: DataAnswer<DataListResult> | null;
  /** The reason the answer did not come, if it did not. */
  error?: string | null;
  /** The folder of the chat in view: its project sources are listed first. */
  folder: string | null;
  /** The name of the source in view. */
  selected: string | null;
  onNavigate: (path: string) => void;
  onAdd: () => void;
};

/** The Data panel's body: ＋ Add, then the sources of this project and yours, each with its privacy chip and size. */
export function DataPanel({ answer, error = null, folder, selected, onNavigate, onAdd }: DataPanelProps) {
  const sources = answer?.status === "ready" ? answer.data.sources : null;
  const groups = sources === null ? null : groupSources(sources, folder);
  let note: string | null = null;
  if (answer === null) note = error === null ? "Loading sources." : "Could not load sources.";
  else if (answer.status === "missing") note = DATA_NOT_AVAILABLE;
  else if (sources?.length === 0) note = "No sources yet. Add files or a database, and golem can answer questions from them.";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Button size="sm" kind="secondary" onClick={onAdd} className="self-start">
        <span aria-hidden="true">＋</span> Add
      </Button>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-0.5">
        {note === null ? null : <p className="px-2.5 py-2 text-sm text-muted">{note}</p>}
        {groups?.project != null && groups.project.length > 0 ? (
          <Group label={`This project · ${folderName(folder)}`} sources={groups.project} selected={selected} onNavigate={onNavigate} />
        ) : null}
        {groups !== null && groups.yours.length > 0 ? <Group label="Yours" sources={groups.yours} selected={selected} onNavigate={onNavigate} /> : null}
      </div>
    </div>
  );
}
