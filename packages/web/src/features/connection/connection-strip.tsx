import type { ConnectionSnapshot } from "../../store/connection.ts";

/**
 * The strip at the panel's foot. It shows nothing while connected, and the wait line while the link is
 * coming back. The states that cannot be used at all get the full screen instead.
 */
export function ConnectionStrip({ snapshot }: { snapshot: ConnectionSnapshot }) {
  const { status } = snapshot.state;
  if (status !== "reconnecting" && status !== "connecting") return null;
  return (
    <p role="status" className="flex items-center gap-2 rounded-md bg-wait-soft px-2.5 py-2 text-xs text-wait">
      <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-xs bg-wait" />
      Reconnecting to golem…
    </p>
  );
}
