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

/** The keys that answer a pending approval, in the order the key list shows them. `key` is lower case. */
export const APPROVAL_KEYS: readonly { key: string; shown: string; label: string; does: ApprovalChoice | "edit" }[] = [
  { key: "enter", shown: "\u21b5", label: "allow once", does: "allow" },
  { key: "s", shown: "S", label: "for this session", does: "allow_session" },
  { key: "w", shown: "W", label: "always", does: "allow_always" },
  { key: "e", shown: "E", label: "edit", does: "edit" },
  { key: "d", shown: "D", label: "deny", does: "deny" },
];

/** What a key does to a pending approval: an answer, or "edit", or null for any other key. */
export function approvalKey(key: string): ApprovalChoice | "edit" | null {
  const lower = key.toLowerCase();
  return APPROVAL_KEYS.find((entry) => entry.key === lower)?.does ?? null;
}

/** The answer a key stands for, or null. */
export function keyDecision(key: string): ApprovalChoice | null {
  const does = approvalKey(key);
  return does === "edit" ? null : does;
}
