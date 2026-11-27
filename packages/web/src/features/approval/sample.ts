import type { ToolBlock } from "@golem/view";
import { SAMPLE_EDIT_DIFF } from "../diff/sample.ts";

const ASKED = { source: "built-in default", subject: "src/socket.ts" } as const;

/** An edit waiting for an answer, with its diff. */
export const PENDING_EDIT: ToolBlock = {
  callId: "ap1",
  name: "edit_file",
  args: { path: "src/socket.ts" },
  status: "waiting",
  diff: SAMPLE_EDIT_DIFF,
  approval: ASKED,
};

/** A shell command waiting for an answer: no diff, so the arguments show. */
export const PENDING_SHELL: ToolBlock = {
  callId: "ap2",
  name: "run_shell",
  args: { command: "pnpm --filter @golem/web test && just check" },
  status: "waiting",
  approval: { source: "project rule", subject: "pnpm --filter @golem/web test && just check" },
};

/** A data export waiting for an answer: the lines of the file it would write, not a diff. */
export const PENDING_EXPORT: ToolBlock = {
  callId: "ap3",
  name: "data_export",
  args: { result: "r_7f2", path: "~/Documents/bank-subscriptions-2026.csv" },
  status: "waiting",
  diff: [
    "query   r_7f2 (select name, count(*) as months, sum(amount) as total from transactions…, 9 rows)",
    "format  csv",
    "path    /Users/you/Documents/bank-subscriptions-2026.csv   new file",
    "source  @bank stays as it is: read-only",
  ].join("\n"),
  approval: { source: "built-in default", subject: null },
};

const answered = (callId: string, answer: NonNullable<ToolBlock["approval"]>["answer"]): ToolBlock => ({
  ...PENDING_EDIT,
  callId,
  status: "requested",
  approval: { ...ASKED, answer },
});

/** Each way a question ends, for the gallery and the tests. */
export const ANSWERED: { label: string; tool: ToolBlock }[] = [
  { label: "Allowed once", tool: answered("an1", { decision: "allow", rule: null, edited: false }) },
  { label: "Allowed once, with edited arguments", tool: answered("an6", { decision: "allow", rule: null, edited: true }) },
  { label: "Allowed for this session", tool: answered("an2", { decision: "allow_session", rule: null, edited: false }) },
  { label: "Always allowed, with a rule", tool: answered("an3", { decision: "allow_always", rule: "edit_file(src/**) → allow", edited: false }) },
  { label: "Denied", tool: { ...answered("an4", { decision: "deny", rule: null, edited: false }), status: "failed", error: "the user denied this tool call" } },
  { label: "Not answered", tool: { ...PENDING_EDIT, callId: "an5", status: "requested", approval: ASKED } },
];
