import type { GolemBlock, GolemFact } from "@golem/view";
import { Badge } from "../../ui/badge.tsx";
import { CopyButton } from "../../ui/copy-command.tsx";

function Fact({ fact }: { fact: GolemFact }) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-faint">{fact.label}</span>
      <code title={fact.title} className="min-w-0 truncate font-mono text-xs text-ink-soft">
        {fact.value}
      </code>
      {fact.copy === null ? null : <CopyButton text={fact.copy} label={`Copy ${fact.label.toLowerCase()} path`} />}
    </div>
  );
}

/** The top of Settings → Setup: the version, then where golem is installed, its files, and its launchd jobs. */
export function GolemBlockView({ block }: { block: GolemBlock }) {
  return (
    <div role="group" aria-label="golem" className="flex flex-col gap-1 rounded-md border border-line bg-sunken px-3 py-2">
      <header className="flex items-center gap-2">
        <h3 className="font-semibold">golem</h3>
        {block.version === "" ? null : <Badge className="px-2 py-0.5">v{block.version.replace(/^v/, "")}</Badge>}
      </header>
      <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        {block.facts.map((fact, index) => (
          <Fact key={`${fact.label}:${index}`} fact={fact} />
        ))}
      </div>
    </div>
  );
}
