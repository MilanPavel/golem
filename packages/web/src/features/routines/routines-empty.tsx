import { routineNewPath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";
import type { RoutineDraft } from "./routine-editor.tsx";
import { PendingButton } from "./routine-detail.tsx";

/** What the watch starter waits for: a routine that starts on a new file is built with file watching. */
export const WATCH_PENDING = "Comes with file watching";

type Starter = { id: string; title: string; line: string; draft: RoutineDraft | null };

/** The starters of the empty state. One with no draft is shown and waits for what it needs. */
export const STARTERS: readonly Starter[] = [
  {
    id: "morning-brief",
    title: "Morning brief",
    line: "Every weekday at 08:30, read your open pull requests and failing checks and leave a summary in the Inbox.",
    draft: { name: "morning-brief", schedule: "30 8 * * 1-5", prompt: "Read my open pull requests and failing checks and leave a summary in the Inbox." },
  },
  { id: "watch-folder", title: "Watch a folder", line: "When a new PDF lands in Downloads, read it and file it where it belongs.", draft: null },
];

/** The draft of a starter named in `/routines?new=<id>`, or null for none (an empty form). */
export function starterDraft(id: string | null): RoutineDraft | null {
  return STARTERS.find((starter) => starter.id === id)?.draft ?? null;
}

/** What `/routines` shows when nothing is set up: what a routine is, and two starters. */
export function RoutinesEmpty({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div data-screen="routines-empty" className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Nothing runs by itself yet</h1>
        <p className="text-sm text-muted">
          A routine starts a session on a schedule, or when a new file appears, and leaves its result in the Inbox. Each one is a table in config.toml.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {STARTERS.map((starter) => (
          <li key={starter.id}>
            <Card className="flex h-full flex-col gap-3">
              <h2 className="text-sm font-semibold">{starter.title}</h2>
              <p className="flex-1 text-sm text-muted">{starter.line}</p>
              <div>
                {starter.draft === null ? (
                  <PendingButton reason={WATCH_PENDING}>Use this starter</PendingButton>
                ) : (
                  <Button size="sm" onClick={() => onNavigate(routineNewPath(starter.id))}>
                    Use this starter
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <div>
        <Button size="sm" kind="primary" onClick={() => onNavigate(routineNewPath())}>
          <span aria-hidden="true">+</span> New routine
        </Button>
      </div>
    </div>
  );
}
