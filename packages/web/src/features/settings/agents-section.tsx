import { agentsTable, wishSetup, type AgentRow, type WishModel, type WishSetup } from "@golem/view";
import { useId, useState } from "react";
import { AGENTS_OLD_TEXT, isAgentsMissing, type AgentInfo } from "../../store/agents.ts";
import { actionErrorText } from "../../store/errors.ts";
import { useAgentList, useModelList, usePageActions } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";
import { useNarrow } from "../trace/use-narrow.ts";
import { FinishedHelpersSection } from "./agents-keep.tsx";
import { AgentDetail, NotYetMark, OriginMark } from "./agents-detail.tsx";
import { TierDot } from "./agents-model.tsx";
import { useSettingsFolder } from "./context.ts";

/** Where an agent type is written, said once under the list. */
const AGENTS_HINT = "Add one as ~/.golem/agents/<name>.md, or .golem/agents/<name>.md in a project.";

type SetWish = ((name: string, wish: string) => Promise<void>) | undefined;

function countLine(count: number): string {
  return `${count} ${count === 1 ? "agent" : "agents"}`;
}

function untrustedLine(names: readonly string[]): string {
  const list = names.join(", ");
  return names.length === 1
    ? `Trust this folder to use its agent ${list}.`
    : `Trust this folder to use its agents ${list}.`;
}

/** The key of a row: a project and a user agent may share a name. */
function keyOf(row: AgentRow): string {
  return `${row.source}/${row.name}`;
}

/** What a row says: the name with its marks, then the wish and the model it becomes. */
function RowFace({ row }: { row: AgentRow }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-x-2">
        <span className="min-w-0 truncate font-ui text-sm font-medium">{row.name}</span>
        {" "}
        <OriginMark row={row} />
        {row.unavailable === null ? null : (
          <>
            {" "}
            <NotYetMark />
          </>
        )}
      </span>{" "}
      <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
        <TierDot tier={row.tier} />
        <Code tone="muted" className="min-w-0 truncate">
          {row.listLine}
        </Code>
      </span>
    </>
  );
}

const ROW_BASE = "flex w-full flex-col gap-y-0.5 rounded-lg border px-3 py-2 text-left outline-offset-2 outline-clay focus-visible:outline-2";

/** The list of the wide layout: one button per agent, the chosen one marked with aria-current. */
function AgentList({ rows, selected, onOpen }: { rows: readonly AgentRow[]; selected: string | null; onOpen: (key: string) => void }) {
  return (
    <ul aria-label="Agents" className="flex flex-col gap-0.5">
      {rows.map((row) => {
        const current = selected === keyOf(row);
        return (
          <li key={keyOf(row)}>
            <button
              type="button"
              onClick={() => onOpen(keyOf(row))}
              aria-current={current ? "true" : undefined}
              className={cn(ROW_BASE, current ? "border-line-strong bg-surface" : "border-transparent hover:border-line", row.unavailable !== null && "opacity-80")}
            >
              <RowFace row={row} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The narrow layout: one column, and a row opens in place with the same content as the detail. */
function AgentRows({ rows, open, onToggle, onSetWish }: { rows: readonly AgentRow[]; open: string | null; onToggle: (key: string) => void; onSetWish: SetWish }) {
  const id = useId();
  return (
    <ul aria-label="Agents" className="flex flex-col gap-2">
      {rows.map((row, at) => {
        const key = keyOf(row);
        const expanded = open === key;
        const panel = `${id}-${at}`;
        return (
          <li key={key} className="rounded-lg border border-line bg-surface">
            <button
              type="button"
              onClick={() => onToggle(key)}
              aria-expanded={expanded}
              aria-controls={panel}
              className={cn(ROW_BASE, "border-transparent")}
            >
              <RowFace row={row} />
            </button>
            {expanded ? (
              <div id={panel} role="group" aria-label={`${row.name} details`} className="border-t border-line px-3 py-3">
                <AgentDetail row={row} onSetWish={onSetWish} showName={false} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The agents as a list and a detail: what each is, the model it wishes for (a dropdown that saves), its tools,
 * limits and prompt, and its file. A narrow window is one column whose rows open in place. A project agent of a
 * folder that is not trusted is not a row; a line says to trust the folder.
 */
export function AgentsPage({
  agents,
  setup = "mixed",
  models = [],
  onSetWish,
  narrow = false,
  start = null,
}: {
  /** The key (`bundled/explorer`) of the agent chosen at first. Without it the wide layout opens the first and the narrow one none. */
  start?: string | null;
  agents: readonly AgentInfo[];
  /** The models a wish can name: the ready ones are choices of the dropdown. */
  models?: readonly WishModel[];
  /** The words of the wish dropdown: local models only, cloud models only, or both. */
  setup?: WishSetup;
  /** Saves a wish. Without it the wish is text. A rejection is shown under the dropdown. */
  onSetWish?: (name: string, wish: string) => Promise<void>;
  /** One column, rows that open in place. */
  narrow?: boolean;
}) {
  const { rows, untrusted } = agentsTable(agents, setup, models);
  const [chosen, setChosen] = useState<string | null>(start);
  const shown = rows.find((row) => keyOf(row) === chosen) ?? (narrow ? undefined : rows[0]);
  const notes = (
    <>
      {untrusted.length === 0 ? null : <p className="text-sm text-muted">{untrustedLine(untrusted)}</p>}
    </>
  );
  if (rows.length === 0) {
    return (
      <div data-setting="helpers" className="flex max-w-column flex-col gap-3">
        <p className="text-sm text-muted">{countLine(0)}</p>
        <p className="text-sm text-muted">{AGENTS_HINT}</p>
        {notes}
      </div>
    );
  }
  if (narrow) {
    return (
      <div data-setting="helpers" className="flex flex-col gap-3">
        <p className="text-sm text-muted">{countLine(rows.length)}</p>
        <AgentRows rows={rows} open={shown === undefined ? null : keyOf(shown)} onToggle={(key) => setChosen(chosen === key ? null : key)} onSetWish={onSetWish} />
        {notes}
      </div>
    );
  }
  return (
    <div data-setting="helpers" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex w-mcp-list shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-bg p-3">
          <p className="px-2 text-sm text-muted">{countLine(rows.length)}</p>
          <AgentList rows={rows} selected={shown === undefined ? null : keyOf(shown)} onOpen={setChosen} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5">
          {shown === undefined ? null : <AgentDetail key={keyOf(shown)} row={shown} onSetWish={onSetWish} />}
        </div>
      </div>
      {notes}
    </div>
  );
}

/** Settings › Agents: the agent types the folder sees, read from the daemon, and the Finished helpers band. */
export function AgentsSection() {
  const folder = useSettingsFolder();
  const list = useAgentList(folder);
  const models = useModelList().data?.models;
  const actions = usePageActions();
  const narrow = useNarrow();
  if (list.isError) {
    if (isAgentsMissing(list.error)) return <p className="text-sm text-muted">{AGENTS_OLD_TEXT}</p>;
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(list.error, "Could not read the agents.")}
        </p>
        <Button size="sm" onClick={() => void list.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (list.data === undefined) return <p className="text-body text-muted">asking the daemon…</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <AgentsPage
        agents={list.data.agents}
        setup={wishSetup(models)}
        models={models ?? []}
        narrow={narrow}
        onSetWish={async (name, wish) => {
          await actions.setAgentWish(name, wish, folder);
        }}
      />
      <FinishedHelpersSection />
    </div>
  );
}
