import type { InboxItem } from "@golem/view";
import { Fragment } from "react";
import { Button } from "../../ui/button.tsx";
import { Code } from "../../ui/code.tsx";
import { inboxKey, type InboxChoice } from "../../store/inbox.ts";

/** The headline with its `code` parts set in mono. */
function Headline({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Code key={index} className="rounded-sm bg-code-bg px-1">
            {part}
          </Code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const ANSWERS: readonly { choice: InboxChoice; label: string }[] = [
  { choice: "allow", label: "Allow once" },
  { choice: "allow_session", label: "Allow for this session" },
  { choice: "deny", label: "Deny" },
];

function InboxCard({
  item,
  busy,
  error,
  onAnswer,
  onOpen,
}: {
  item: InboxItem;
  busy: boolean;
  error: string | undefined;
  onAnswer: (item: InboxItem, choice: InboxChoice) => void;
  onOpen: (item: InboxItem) => void;
}) {
  return (
    <li className="rounded-lg border border-line-strong bg-surface p-3" data-inbox-card={item.kind}>
      <p className="text-sm leading-snug font-medium wrap-anywhere">
        <Headline text={item.headline} />
      </p>
      <p className="mt-1 flex items-baseline gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{item.sessionTitle}</span>
        {item.age === "" ? null : <span className="flex-none text-faint">{item.age}</span>}
      </p>
      {item.source === null ? null : <p className="mt-0.5 text-meta text-faint wrap-anywhere">{item.source}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.kind === "approval" && item.callId !== null
          ? ANSWERS.map(({ choice, label }) => (
              <Button
                key={choice}
                size="sm"
                kind={choice === "allow" ? "ink" : choice === "deny" ? "danger" : "secondary"}
                disabled={busy}
                aria-label={`${label}, ${item.sessionTitle}`}
                onClick={() => {
                  onAnswer(item, choice);
                }}
              >
                {label}
              </Button>
            ))
          : null}
        <Button
          size="sm"
          kind="ghost"
          aria-label={`Open, ${item.sessionTitle}`}
          onClick={() => {
            onOpen(item);
          }}
        >
          Open
        </Button>
      </div>
      {error === undefined ? null : (
        <p role="alert" className="mt-2 text-xs text-deny wrap-anywhere">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * What waits for the user, one card each, in the order given. `busy` and `errors` are by `inboxKey`.
 * The panel holds no state: the store answers and removes.
 */
export function InboxPanel({
  items,
  busy = {},
  errors = {},
  label = "Inbox",
  onAnswer,
  onOpen,
}: {
  items: readonly InboxItem[];
  busy?: Readonly<Record<string, boolean>>;
  errors?: Readonly<Record<string, string>>;
  label?: string;
  onAnswer: (item: InboxItem, choice: InboxChoice) => void;
  onOpen: (item: InboxItem) => void;
}) {
  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-muted">Nothing is waiting for you.</p>;
  }
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((item) => {
        const key = inboxKey(item);
        return <InboxCard key={key} item={item} busy={busy[key] === true} error={errors[key]} onAnswer={onAnswer} onOpen={onOpen} />;
      })}
    </ul>
  );
}
