import type { ReactNode } from "react";
import { useNavigate } from "../../store/page-context.tsx";
import { sessionPath, tracePath } from "../../store/router.ts";
import { cn } from "../../ui/cn.ts";
import { Link } from "../../ui/link.tsx";
import { TAB_LOOK } from "../../ui/tabs.tsx";

const TAB = cn(TAB_LOOK, "aria-[current=page]:border-clay aria-[current=page]:text-ink");

/**
 * The second row of a session, on both views: the `Chat | Trace` tabs on the left, the view's own
 * summary on the right. Each tab is a link to its route, so the current one is `aria-current="page"`
 * and a modified click opens a new browser tab.
 */
export function SessionViewBar({ id, view, children }: { id: string; view: "chat" | "trace"; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-3 border-b border-line px-4">
      <nav aria-label="View" className="flex gap-1 self-end">
        <Link href={sessionPath(id)} onNavigate={navigate} aria-current={view === "chat" ? "page" : undefined} className={TAB}>
          Chat
        </Link>
        <Link href={tracePath(id)} onNavigate={navigate} aria-current={view === "trace" ? "page" : undefined} className={TAB}>
          Trace
        </Link>
      </nav>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 py-1">{children}</div>
    </div>
  );
}
