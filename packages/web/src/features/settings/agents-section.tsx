import { AGENT_GROUPS, agentsTable, wishSetup, type AgentRow, type WishModel, type WishSetup } from "@golem/view";
import { useState } from "react";
import { AGENTS_OLD_TEXT, isAgentsMissing, type AgentInfo } from "../../store/agents.ts";
import { actionErrorText } from "../../store/errors.ts";
import { useAgentList, useModelList, usePageActions } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../../ui/menu.tsx";
import { useSettingsFolder } from "./context.ts";

/** Where an agent type is written, said once under the table. */
const AGENTS_HINT = "Add one as ~/.golem/agents/<name>.md, or .golem/agents/<name>.md in a project.";

const HEAD = "pr-3 pb-2 text-left font-mono text-micro font-semibold tracking-wider text-faint uppercase";

function countLine(count: number): string {
  return `${count} ${count === 1 ? "agent" : "agents"}`;
}

function untrustedLine(names: readonly string[]): string {
  const list = names.join(", ");
  return names.length === 1
    ? `Trust this folder to use its agent ${list}.`
    : `Trust this folder to use its agents ${list}.`;
}

/** The line under a wish dropdown when the daemon refused it. A daemon that does not know `agents.set_wish` is said in words. */
function wishErrorText(error: unknown, name: string): string {
  if (isAgentsMissing(error)) return "This golem is too old to change a wish. Update golem.";
  return actionErrorText(error, `Could not change the wish of ${name}.`);
}

/** `now: <model>`, with why as its title and a fresh window said in words. */
function NowLine({ row }: { row: AgentRow }) {
  if (row.now === null) return null;
  return (
    <span className="block font-mono text-xs text-muted" title={row.now.reason === "" ? undefined : row.now.reason}>
      {row.now.text}
      {row.now.freshWindow === "" ? null : `, ${row.now.freshWindow}`}
      {row.now.reason === "" ? null : <span className="sr-only">{`. ${row.now.reason}`}</span>}
    </span>
  );
}

/**
 * The wish of a type: a dropdown that saves each change, with what it means now. A broken type, or a page with
 * nothing to save with, shows the wish as text. A refusal is a line below and the old value stays.
 */
function WishCell({ row, onSetWish }: { row: AgentRow; onSetWish: ((name: string, wish: string) => Promise<void>) | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!row.editable || onSetWish === undefined) {
    return (
      <>
        {row.wish}
        <NowLine row={row} />
      </>
    );
  }
  const choose = async (wish: string): Promise<void> => {
    if (wish === row.wishValue) return;
    setSaving(true);
    try {
      await onSetWish(row.name, wish);
      setError(null);
    } catch (failure) {
      setError(wishErrorText(failure, row.name));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <Menu>
        <MenuTrigger
          disabled={saving}
          aria-label={`Model wish of ${row.name}: ${row.wish}. Change it.`}
          className="cursor-pointer rounded-md border border-line px-2 py-1 text-left text-sm text-ink outline-offset-2 outline-clay hover:border-ink focus-visible:outline-2 disabled:cursor-default disabled:opacity-60"
        >
          {row.wish}
        </MenuTrigger>
        <MenuContent className="w-72 max-sm:w-64">
          <MenuRadioGroup value={row.wishValue} onValueChange={(value) => void choose(value)}>
            {row.wishOptions.map((option) => (
              <MenuRadioItem key={option.value} value={option.value}>
                <span>{option.label}</span>
                {option.hint === "" ? null : <span className="text-xs text-muted">{option.hint}</span>}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      <NowLine row={row} />
      {error === null ? null : (
        <span role="alert" className="block text-xs text-deny">
          {error}
        </span>
      )}
    </>
  );
}

function AgentCells({ row, onSetWish }: { row: AgentRow; onSetWish: ((name: string, wish: string) => Promise<void>) | undefined }) {
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        <span className="font-ui text-sm font-medium">{row.name}</span>{" "}
        <span className="ml-2 font-mono text-xs whitespace-nowrap text-faint">{AGENT_GROUPS[row.source]}</span>{" "}
        {row.description === "" ? null : <span className="block text-xs text-muted">{row.description}</span>}
        {row.warnings.map((text) => (
          <span key={text} role="note" className={cn("block font-mono text-xs wrap-anywhere", row.tone === "bad" ? "text-deny" : "text-muted")}>
            {text}
          </span>
        ))}
      </th>
      <td className="py-2 pr-3 text-sm text-muted">
        <WishCell row={row} onSetWish={onSetWish} />
      </td>
      <td className="py-2 pr-3 text-right font-mono text-sm">{row.used}</td>
      <td className="py-2 text-right font-mono text-sm">{row.finished}</td>
    </tr>
  );
}

/**
 * The agent types as a table: what each is, the model it wishes for (a dropdown that saves), and how many helpers
 * of it ran in the last 30 days. A project agent of a folder that is not trusted is not a row; a line
 * says to trust the folder.
 */
export function AgentsTable({
  agents,
  setup = "mixed",
  models = [],
  onSetWish,
}: {
  /** The models a wish can name: the ready ones are choices of the dropdown. */
  models?: readonly WishModel[];
  agents: readonly AgentInfo[];
  /** The words of the wish dropdown: local models only, cloud models only, or both. */
  setup?: WishSetup;
  /** Saves a wish. Without it the wish is text. A rejection is shown under the dropdown. */
  onSetWish?: (name: string, wish: string) => Promise<void>;
}) {
  const { rows, untrusted } = agentsTable(agents, setup, models);
  return (
    <div data-setting="helpers" className="flex max-w-column flex-col gap-3">
      <p className="text-sm text-muted">{countLine(rows.length)}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{AGENTS_HINT}</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Agents, and the helpers of each in the last 30 days</caption>
          <thead>
            <tr>
              <th scope="col" className={HEAD}>
                Agent
              </th>
              <th scope="col" className={HEAD}>
                Wish
              </th>
              <th scope="col" className={cn(HEAD, "text-right")} title="Helpers started in the last 30 days">
                Used
              </th>
              <th scope="col" className={cn(HEAD, "pr-0 text-right")} title="Helpers that finished their job in the last 30 days">
                Finished
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AgentCells key={`${row.source}/${row.name}`} row={row} onSetWish={onSetWish} />
            ))}
          </tbody>
        </table>
      )}
      {untrusted.length === 0 ? null : <p className="text-sm text-muted">{untrustedLine(untrusted)}</p>}
      <p className="text-xs text-faint">Used and Finished count helpers in the last 30 days.</p>
    </div>
  );
}

/** Settings › Agents: the agent types the folder sees, read from the daemon. */
export function AgentsSection() {
  const folder = useSettingsFolder();
  const list = useAgentList(folder);
  const models = useModelList().data?.models;
  const actions = usePageActions();
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
  if (list.data === undefined) return <p className="font-mono text-sm text-muted">asking the daemon…</p>;
  return (
    <AgentsTable
      agents={list.data.agents}
      setup={wishSetup(models)}
      models={models ?? []}
      onSetWish={async (name, wish) => {
        await actions.setAgentWish(name, wish, folder);
      }}
    />
  );
}
