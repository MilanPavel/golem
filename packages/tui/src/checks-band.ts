import { checksQuestion } from "@golem/view";

/** What the keys say, always shown. */
export const CHECKS_KEYS = "y run them · n not in this chat";

/** One row: the question, the commands cut to what fits, and the keys. */
export function checksBandText(offered: readonly { name: string; command: string }[], columns: number): string {
  const question = checksQuestion(offered);
  const head = `${question.text} `;
  const tail = `  ${CHECKS_KEYS}`;
  const room = Math.max(0, columns - head.length - tail.length);
  const commands = question.commands.join(" · ");
  const shown = commands.length <= room ? commands : room > 1 ? `${commands.slice(0, room - 1)}…` : "";
  return `${head}${shown}${tail}`;
}
