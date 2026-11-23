/**
 * The setting "Use helpers" and the card that "Ask me first" shows (ADR-059). Pure, so the web and the terminal say
 * the same words. Nothing here knows how a screen draws them.
 */

/** `[agents] use_helpers`, as the daemon spells it. */
export type UseHelpersValue = "when_needed" | "ask" | "never";

/** The source an `approval.needed` of this question carries. */
export const USE_HELPERS_SOURCE = "use_helpers";

/** One position of the setting, with the line that says what it does. */
export interface UseHelpersPosition {
  value: UseHelpersValue;
  label: string;
  explain: string;
}

/** The three positions, in the order they are shown. */
export const USE_HELPERS_POSITIONS: readonly UseHelpersPosition[] = [
  {
    value: "when_needed",
    label: "When needed",
    explain: "the reading would not fit the window, or several jobs can run at once, or a stronger model is worth one question.",
  },
  {
    value: "ask",
    label: "Ask me first",
    explain: "golem shows the helpers it wants to start, with what each is asked, and waits for your Run.",
  },
  {
    value: "never",
    label: "Never",
    explain: "golem does all the work itself in the chat, however large it is.",
  },
];

/** The position a daemon value stands for; a value this build does not know reads as "When needed", as the daemon does. */
export function useHelpersPosition(value: string | null | undefined): UseHelpersPosition {
  return USE_HELPERS_POSITIONS.find((position) => position.value === value) ?? (USE_HELPERS_POSITIONS[0] as UseHelpersPosition);
}

/** The one line under the control for the chosen position, such as `Never: golem does all the work itself…`. */
export function useHelpersExplain(value: string | null | undefined): string {
  const position = useHelpersPosition(value);
  return `${position.label}: ${position.explain}`;
}

/** The helper a `delegate` call names when it names none. */
const DEFAULT_AGENT = "explorer";

/** One helper of the batch, as the `delegate` call names it. */
export interface HelperCardJob {
  agent: string;
  brief: string;
  label: string | null;
}

/** An answer of the card. `run` is what goes to `helpers.respond`. */
export interface HelperCardAction {
  id: "run" | "chat";
  label: string;
  run: boolean;
  /** The key that answers: Enter runs. */
  key: "enter" | null;
  primary: boolean;
}

/** What the card shows: a head, the briefs, and the two answers. */
export interface HelperCardModel {
  /** `1 helper · explorer`, `3 helpers · explorer ×2, worker`. */
  head: string;
  count: number;
  jobs: HelperCardJob[];
  actions: readonly HelperCardAction[];
}

/** "Run" and "Do it in the chat". Neither has a "for this session" form. */
export const HELPER_CARD_ACTIONS: readonly HelperCardAction[] = [
  { id: "run", label: "Run", run: true, key: "enter", primary: true },
  { id: "chat", label: "Do it in the chat", run: false, key: null, primary: false },
];

/** `1 helper` or `3 helpers`. */
function helperWords(count: number): string {
  return `${String(count)} ${count === 1 ? "helper" : "helpers"}`;
}

/** `explorer ×2, worker`: each agent type once, in order of first use, with its count when above 1. */
function agentWords(agents: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const agent of agents) counts.set(agent, (counts.get(agent) ?? 0) + 1);
  return [...counts].map(([agent, count]) => (count > 1 ? `${agent} ×${String(count)}` : agent)).join(", ");
}

/**
 * The head of the card: `1 helper · explorer`. `agents` is one name per helper; without names the head is the
 * count alone, from `count` (default 1).
 */
export function helperBatchHead(agents: readonly string[], count?: number | null): string {
  if (agents.length > 0) return `${helperWords(agents.length)} · ${agentWords(agents)}`;
  return helperWords(Math.max(1, count ?? 1));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function jobOf(value: unknown): HelperCardJob | null {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  const label = text(entry.label);
  return { agent: text(entry.agent) || DEFAULT_AGENT, brief: text(entry.brief), label: label === "" ? null : label };
}

/** The helpers a `delegate` call's arguments name: `{agent, brief}` for one, `{batch: [...]}` for several. */
export function helperJobsOf(args: Readonly<Record<string, unknown>> | null | undefined): HelperCardJob[] {
  if (args === null || args === undefined) return [];
  if (Array.isArray(args.batch)) {
    return (args.batch as unknown[]).map(jobOf).filter((job): job is HelperCardJob => job !== null);
  }
  const single = jobOf(args);
  return single === null || (single.brief === "" && text(args.agent) === "") ? [] : [single];
}

/**
 * The card for a question about starting helpers. The input is what is at hand: the arguments of the `delegate`
 * call (from `approval.needed`), or the `batch` pending item's `helper_count` and `agents`. The arguments win for
 * the names and briefs; the pending item fills in what they leave out.
 */
export function helperCardOf(input: {
  args?: Readonly<Record<string, unknown>> | null;
  helperCount?: number | null;
  agents?: readonly string[] | null;
}): HelperCardModel {
  const jobs = helperJobsOf(input.args);
  const agents = jobs.length > 0 ? jobs.map((job) => job.agent) : [...(input.agents ?? [])];
  const count = jobs.length > 0 ? jobs.length : agents.length > 0 ? agents.length : Math.max(1, input.helperCount ?? 1);
  return { head: helperBatchHead(agents, count), count, jobs, actions: HELPER_CARD_ACTIONS };
}

/** Whether an `approval.needed` is this question: the tool `delegate` asked by the setting. */
export function isUseHelpersQuestion(approval: { name?: string | null; source?: string | null } | null | undefined): boolean {
  return (
    approval !== null &&
    approval !== undefined &&
    approval.source === USE_HELPERS_SOURCE &&
    (approval.name === undefined || approval.name === null || approval.name === "delegate")
  );
}
