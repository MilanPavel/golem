import { CopyCommand } from "../../ui/copy-command.tsx";

/** One line under the composer: what a command did, or where to find what the page lacks. */
export type CommandNotice = {
  text: string;
  /** A command to run in a terminal, shown in mono with a Copy button. */
  command?: string;
};

/** The notice as a status line, muted. */
export function NoticeLine({ notice }: { notice: CommandNotice }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted">
      <span>{notice.text}</span>
      {notice.command === undefined ? null : <CopyCommand command={notice.command} />}
    </p>
  );
}
