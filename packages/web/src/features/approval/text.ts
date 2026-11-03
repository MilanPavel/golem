import type { ApprovalAnswer, ToolBlock, ApprovalChoice } from "@golem/view";
import { squeezeArgs } from "../chat/format.ts";

/** What the question is about: a file's name (the path in `full`), the daemon's subject, or the arguments. */
export function approvalTarget(args: ToolBlock["args"], subject: string | null): { short: string; full: string } | null {
  const path = args.path;
  if (typeof path === "string" && path !== "") {
    const trimmed = path.replace(/\/+$/, "");
    const name = trimmed.slice(trimmed.lastIndexOf("/") + 1);
    return { short: name === "" ? path : name, full: path };
  }
  const text = subject !== null && subject !== "" ? subject : squeezeArgs(args);
  return text === "" ? null : { short: text, full: text };
}

/** The line under an answered approval, without its mark. */
export function verdictText(answer: ApprovalAnswer): string {
  switch (answer.decision) {
    case "allow":
      return answer.edited ? "Allowed once, with edited arguments" : "Allowed once";
    case "allow_session":
      return "Allowed for this session";
    case "allow_always":
      return answer.rule ? `Always allowed, rule ${answer.rule}` : "Always allowed";
    case "deny":
      return "Denied";
  }
}

/** The answer a key stands for, or null. */
export function keyDecision(key: string): ApprovalChoice | null {
  switch (key) {
    case "Enter":
      return "allow";
    case "s":
    case "S":
      return "allow_session";
    case "w":
    case "W":
      return "allow_always";
    case "d":
    case "D":
      return "deny";
    default:
      return null;
  }
}
