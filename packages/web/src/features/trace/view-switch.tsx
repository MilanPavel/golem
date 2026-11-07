import { useNavigate } from "../../store/page-context.tsx";
import { sessionPath, tracePath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";

/**
 * The `Chat | Trace` switch in a session's top bar. The current view is pressed. On the chat it
 * hides below 760 px, where the bar has no room; the trace page keeps it to go back.
 */
export function ViewSwitch({ id, view }: { id: string; view: "chat" | "trace" }) {
  const navigate = useNavigate();
  return (
    <div role="group" aria-label="View" className={`flex gap-0.5 ${view === "chat" ? "max-narrow:hidden" : ""}`}>
      <Button
        kind={view === "chat" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={view === "chat"}
        onClick={() => view !== "chat" && navigate(sessionPath(id))}
      >
        Chat
      </Button>
      <Button
        kind={view === "trace" ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={view === "trace"}
        onClick={() => view !== "trace" && navigate(tracePath(id))}
      >
        Trace
      </Button>
    </div>
  );
}
