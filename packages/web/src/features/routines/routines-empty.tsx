import { Card } from "../../ui/card.tsx";
import { PendingButton } from "./routine-detail.tsx";

/** The routine editor is its own ticket (4.6.2); until it lands the starters are shown and wait for it. */
export const EDITOR_PENDING = "Comes with the routine editor";

const STARTERS = [
  { title: "Morning brief", line: "Every weekday at 08:30, read your open pull requests and failing checks and leave a summary in the Inbox." },
  { title: "Watch a folder", line: "When a new PDF lands in Downloads, read it and file it where it belongs." },
] as const;

/** What `/routines` shows when nothing is set up: what a routine is, and two starters. */
export function RoutinesEmpty() {
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
          <li key={starter.title}>
            <Card className="flex h-full flex-col gap-3">
              <h2 className="text-sm font-semibold">{starter.title}</h2>
              <p className="flex-1 text-sm text-muted">{starter.line}</p>
              <div>
                <PendingButton reason={EDITOR_PENDING}>Use this starter</PendingButton>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
