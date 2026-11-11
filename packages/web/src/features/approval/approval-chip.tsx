import { displayToolName, type ToolBlock } from "@golem/view";
import { cn } from "../../ui/cn.ts";
import { chipText, verdictText } from "./text.ts";

/** How a question about a tool call ended, as a small chip under its row: `✓ get_me · this chat`. */
export function ApprovalChip({ tool }: { tool: ToolBlock }) {
  const approval = tool.approval;
  if (approval === undefined) return null;
  const answer = approval.answer;
  const denied = answer?.decision === "deny";
  return (
    <span
      data-approval-chip={answer?.decision ?? "none"}
      title={answer === undefined ? "Not answered" : verdictText(answer)}
      className={cn(
        "mt-0.5 mb-1 ml-4 inline-flex w-fit max-w-full items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-xs",
        answer === undefined ? "bg-sunken text-muted" : denied ? "bg-deny-soft text-deny" : "bg-allow-soft text-allow",
      )}
    >
      <span aria-hidden="true">{answer === undefined ? "–" : denied ? "✗" : "✓"}</span>
      <span className="truncate">
        {displayToolName(tool.name)} · {chipText(answer)}
      </span>
    </span>
  );
}
