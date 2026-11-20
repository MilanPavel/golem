import { formatCost, formatCount, helperCost, referenceName, roleName } from "@golem/view";
import type { CostGetResult } from "../../store/cost.ts";
import { actionErrorText } from "../../store/errors.ts";
import { useCost } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { cn } from "../../ui/cn.ts";
import { Code } from "../../ui/code.tsx";

export const NO_CALLS = "No model calls yet.";

/** The short weekday of a local day such as `2026-11-14`. */
function weekday(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString(undefined, { weekday: "short" });
}

function Tile({ title, value, caption }: { title: string; value: string; caption: string }) {
  return (
    <div role="group" aria-label={title} data-setting={title.toLowerCase()} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4">
      <span className="text-sm text-muted">{title}</span>
      <span className="text-title font-semibold">{value}</span>
      <span className="text-xs text-faint">{caption}</span>
    </div>
  );
}

const callsLine = (calls: number, tokens: number): string =>
  `${calls} ${calls === 1 ? "call" : "calls"} · ${formatCount(tokens)} tokens`;

/** One bar per day: local tokens below, paid tokens above, as a share of the busiest day. */
function Bars({ days }: { days: NonNullable<CostGetResult["by_day"]> }) {
  const top = Math.max(1, ...days.map((day) => day.local_tokens + day.paid_tokens));
  return (
    <ul aria-label="Tokens per day" className="flex h-40 items-end gap-3">
      {days.map((day) => {
        const local = (day.local_tokens / top) * 100;
        const paid = (day.paid_tokens / top) * 100;
        return (
          <li key={day.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="sr-only">
              {`${weekday(day.day)}: ${formatCount(day.local_tokens)} local tokens, ${formatCount(day.paid_tokens)} paid tokens`}
            </span>
            <div aria-hidden="true" className="flex w-full max-w-10 flex-1 flex-col justify-end">
              <div data-bar="paid" className="w-full bg-clay" style={{ height: `${paid}%` }} />
              <div data-bar="local" className="w-full bg-allow" style={{ height: `${local}%` }} />
            </div>
            <span aria-hidden="true" className="text-xs text-faint">
              {weekday(day.day)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const CELL = "px-3 py-1.5";
const NUM = cn(CELL, "text-right");

/** The page's body for one `cost.get` result. */
export function UsageView({ result }: { result: CostGetResult }) {
  if (result.week.calls === 0) return <p className="text-sm text-muted">{NO_CALLS}</p>;
  const reference = result.saved_reference;
  const days = result.by_day ?? [];
  const models = [...(result.by_model ?? [])].sort(
    (a, b) => b.cost_usd - a.cost_usd || b.input + b.output - (a.input + a.output),
  );
  const roles = result.by_role ?? [];
  const helpers = helperCost(result);
  return (
    <div className="flex max-w-column flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile title="Today" value={formatCost(result.today.cost_usd)} caption={callsLine(result.today.calls, result.today.input + result.today.output)} />
        <Tile title="This week" value={formatCost(result.week.cost_usd)} caption={callsLine(result.week.calls, result.week.input + result.week.output)} />
        {reference == null || reference === "" ? null : (
          <Tile title="Saved by running locally" value={formatCost(result.week.saved_usd)} caption={`against ${referenceName(reference)} prices`} />
        )}
      </div>
      {days.length === 0 ? null : (
        <section aria-label="Last 7 days" data-setting="last 7 days" className="flex flex-col gap-2">
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="size-2 bg-allow" /> Local tokens
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="size-2 bg-clay" /> Paid tokens
            </span>
          </div>
          <Bars days={days} />
        </section>
      )}
      <table className="w-full text-left text-sm">
        <caption className="sr-only">By model, last 7 days</caption>
        <thead className="border-b border-line text-muted">
          <tr>
            <th scope="col" className={CELL}>Model</th>
            <th scope="col" className={CELL}>Tier</th>
            <th scope="col" className={cn(CELL, "text-right")}>Calls</th>
            <th scope="col" className={cn(CELL, "text-right")}>Tokens in</th>
            <th scope="col" className={cn(CELL, "text-right")}>Tokens out</th>
            <th scope="col" className={cn(CELL, "text-right")}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {models.map((row) => (
            <tr key={`${row.provider ?? ""}/${row.model ?? ""}`} className="border-b border-line">
              <td className={CELL}>{row.model === null ? "unknown" : <Code>{row.model}</Code>}</td>
              <td className={CELL}>{row.tier ?? "unknown"}</td>
              <td className={NUM}>{row.calls}</td>
              <td className={NUM}>{formatCount(row.input)}</td>
              <td className={NUM}>{formatCount(row.output)}</td>
              <td className={NUM}>{formatCost(row.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {helpers === null ? null : (
        <section aria-label="Helpers" className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Helpers, last 7 days</h3>
          <p className="text-sm">
            <span className="font-mono">{helpers.cost}</span>
            {helpers.share === "" ? "" : `, ${helpers.share} of the week`}
            {` · ${helpers.calls} ${helpers.calls === 1 ? "call" : "calls"} · ${helpers.tokens} tokens`}
          </p>
          <p className="text-xs text-faint">All helper types together. The daemon does not split the cost by type yet.</p>
        </section>
      )}
      {roles.length < 2 ? null : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">By job, last 7 days</caption>
          <thead className="border-b border-line text-muted">
            <tr>
              <th scope="col" className={CELL}>Job</th>
              <th scope="col" className={cn(CELL, "text-right")}>Calls</th>
              <th scope="col" className={cn(CELL, "text-right")}>Tokens in</th>
              <th scope="col" className={cn(CELL, "text-right")}>Tokens out</th>
              <th scope="col" className={cn(CELL, "text-right")}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((row) => (
              <tr key={row.role} className="border-b border-line">
                <td className={CELL}>{roleName(row.role)}</td>
                <td className={NUM}>{row.calls}</td>
                <td className={NUM}>{formatCount(row.input)}</td>
                <td className={NUM}>{formatCount(row.output)}</td>
                <td className={NUM}>{formatCost(row.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Settings › Usage: what model calls cost, from `cost.get`. The page adds nothing up itself. */
export function UsageSection() {
  const cost = useCost();
  if (cost.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {actionErrorText(cost.error, "Could not read the usage.")}
        </p>
        <Button size="sm" onClick={() => void cost.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  if (cost.data === undefined) return <p className="text-body text-muted">asking the daemon…</p>;
  return <UsageView result={cost.data} />;
}
