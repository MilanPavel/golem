import { shellTrackingNote } from "@golem/view";
import { useShellTracking } from "../../store/page-context.tsx";

/** A quiet line above the changes when shell commands are not watched in this folder. */
export function ShellNote({ sessionId }: { sessionId: string }) {
  const note = shellTrackingNote(useShellTracking(sessionId));
  return note === null ? null : <p className="text-xs text-faint">{note}</p>;
}
