import { useSession, useSessionList } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";
import { cn } from "../../ui/cn.ts";
import { FolderIcon } from "../../ui/icons.tsx";
import { folderName } from "../sessions/folder.ts";
import { BAR_CHIP, ICON_UNDER_400 } from "./composer-bar.ts";

/** The look of the folder chip: it shrinks before the model does, and under 400 px it is the icon alone. */
export const FOLDER_CHIP = cn(BAR_CHIP, "max-w-44 shrink-2");

/** The folder's name in the chip. Under 400 px it stays for screen readers only. */
export function FolderChipName({ folder }: { folder: string | null }) {
  return <span className={cn("min-w-0 truncate", ICON_UNDER_400)}>{folderName(folder)}</span>;
}

/** The folder of a session in the composer's row. It is fixed for the session, so it has no menu. */
export function FolderBarBadge({ folder }: { folder: string | null }) {
  return (
    <span title={folder ?? undefined} className={cn(FOLDER_CHIP, "cursor-default hover:bg-transparent hover:text-muted")}>
      <FolderIcon />
      <FolderChipName folder={folder} />
    </span>
  );
}

const selectCwd = (view: SessionView) => view.cwd;
const selectStatus = (view: SessionView) => view.status;

/** The badge of a session, or nothing while its folder is not known. */
export function SessionFolder({ sessionId }: { sessionId: string }) {
  const cwd = useSession(sessionId, selectCwd);
  const status = useSession(sessionId, selectStatus);
  const summary = useSessionList().find((session) => session.session_id === sessionId);
  const folder = summary ? (summary.cwd ?? null) : status === "ready" ? cwd : undefined;
  if (folder === undefined) return null;
  return <FolderBarBadge folder={folder} />;
}
