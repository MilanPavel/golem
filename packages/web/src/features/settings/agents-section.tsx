import { AGENT_GROUPS, agentsTable, type AgentRow } from "@golem/view";
import { AGENTS_OLD_TEXT, isAgentsMissing, type AgentInfo } from "../../store/agents.ts";
import { actionErrorText } from "../../store/errors.ts";
import { useAgentList } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
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

function AgentCells({ row }: { row: AgentRow }) {
  return (
    <tr className="border-t border-line align-top">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        <span className="font-sans text-sm font-medium">{row.name}</span>{" "}
        <span className="ml-2 font-mono text-xs whitespace-nowrap text-faint">{AGENT_GROUPS[row.source]}</span>{" "}
        {row.description === "" ? null : <span className="block text-xs text-muted">{row.description}</span>}
        {row.warnings.map((text) => (
          <span key={text} role="note" className={cn("block font-mono text-xs wrap-anywhere", row.tone === "bad" ? "text-deny" : "text-muted")}>
            {text}
          </span>
        ))}
      </th>
      <td className="py-2 pr-3 text-sm text-muted">{row.wish}</td>
      <td className="py-2 pr-3 text-right font-mono text-sm">{row.used}</td>
      <td className="py-2 text-right font-mono text-sm">{row.finished}</td>
    </tr>
  );
}

/**
 * The agent types as a read-only table: what each is, the model it wishes for, and how many helpers
 * of it ran in the last 30 days. A project agent of a folder that is not trusted is not a row; a line
 * says to trust the folder.
 */
export function AgentsTable({ agents }: { agents: readonly AgentInfo[] }) {
  const { rows, untrusted } = agentsTable(agents);
  return (
    <div className="flex max-w-column flex-col gap-3">
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
              <AgentCells key={`${row.source}/${row.name}`} row={row} />
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
  return <AgentsTable agents={list.data.agents} />;
}
