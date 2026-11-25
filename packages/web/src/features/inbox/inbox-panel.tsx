import { helperCardOf, helperEstimateLine, inboxAnswerOptions, inboxHelperAskWords, type ApprovalAnswerOption, type ApprovalChoice, type InboxGroup, type InboxItem } from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { inboxKey, type InboxChoice } from "../../store/inbox.ts";
import { Headline } from "./headline.tsx";

type OnAnswer = (item: InboxItem, choice: ApprovalChoice, scope?: "batch", cheaper?: boolean) => void;

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
  onAnswer: OnAnswer;
  onOpen: (item: InboxItem) => void;
}) {
  const helper = item.helper;
  const asks = inboxHelperAskWords(item.count);
  const options: readonly ApprovalAnswerOption[] = helper === null ? [] : inboxAnswerOptions(item);
  return (
    <li className="rounded-lg border border-line-strong bg-surface p-3" data-inbox-card={item.kind}>
      <p className="text-sm leading-snug font-medium wrap-anywhere">
        <Headline text={item.headline} />
      </p>
      {helper === null ? null : (
        <p className="mt-1 text-xs font-medium wrap-anywhere" data-helper-name="">
          {helper.name}
          {asks === null ? null : <span className="font-normal text-muted"> · {asks}</span>}
        </p>
      )}
      <p className="mt-1 flex items-baseline gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{item.sessionTitle}</span>
        {item.age === "" ? null : <span className="flex-none text-faint">{item.age}</span>}
      </p>
      {item.estimate === null ? null : (
        <p className="mt-0.5 text-xs text-muted wrap-anywhere" data-helper-estimate="">
          {helperEstimateLine(item.estimate)}
        </p>
      )}
      {item.source === null ? null : <p className="mt-0.5 text-meta text-faint wrap-anywhere">{item.source}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {options.map((option) => (
          <Button
            key={option.id}
            size="sm"
            kind={option.id === "once" ? "ink" : option.id === "deny" ? "danger" : "secondary"}
            disabled={busy}
            data-answer={option.id}
            aria-label={`${option.label}, ${helper?.name ?? ""}, ${item.sessionTitle}`}
            onClick={() => {
              if (option.scope === undefined) onAnswer(item, option.decision);
              else onAnswer(item, option.decision, option.scope);
            }}
          >
            {option.label}
          </Button>
        ))}
        {item.kind === "batch" && item.callId !== null
          ? helperCardOf({ helperCount: item.agents.length, agents: item.agents, estimate: item.estimate }).actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                kind={action.primary ? "ink" : "secondary"}
                disabled={busy}
                data-helper-answer={action.id}
                aria-label={`${action.label}, ${item.sessionTitle}`}
                onClick={() => {
                  if (action.cheaper) onAnswer(item, "allow", undefined, true);
                  else onAnswer(item, action.run ? "allow" : "deny");
                }}
              >
                {action.label}
              </Button>
            ))
          : null}
        {helper === null && item.kind === "approval" && item.callId !== null
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
 * What waits for the user, one card each, in the order given. `busy` and `errors` are by `inboxKey`. With
 * `groups` (from `inboxGroups`), a lead whose helpers ask shows one heading with how many wait, and its cards
 * under it; `groups` wins over `items`. The panel holds no state: the store answers and removes.
 */
export function InboxPanel({
  items,
  groups,
  busy = {},
  errors = {},
  label = "Inbox",
  onAnswer,
  onOpen,
}: {
  items: readonly InboxItem[];
  groups?: readonly InboxGroup[];
  busy?: Readonly<Record<string, boolean>>;
  errors?: Readonly<Record<string, string>>;
  label?: string;
  onAnswer: OnAnswer;
  onOpen: (item: InboxItem) => void;
}) {
  if (items.length === 0 && (groups === undefined || groups.length === 0)) {
    return <p className="px-3 py-6 text-center text-sm text-muted">Nothing is waiting for you.</p>;
  }
  const card = (item: InboxItem) => {
    const key = inboxKey(item);
    return <InboxCard key={key} item={item} busy={busy[key] === true} error={errors[key]} onAnswer={onAnswer} onOpen={onOpen} />;
  };
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {groups === undefined
        ? items.map(card)
        : groups.map((group) =>
            group.items.some((item) => item.helper !== null) ? (
              <li key={group.sessionId} data-inbox-group={group.sessionId}>
                <p className="mb-1 flex items-baseline gap-2 px-1 text-xs font-medium">
                  <span className="min-w-0 truncate">{group.sessionTitle}</span>
                  <span className="flex-none font-normal text-muted">{group.waiting} waiting</span>
                </p>
                <ul aria-label={`${group.sessionTitle}, ${String(group.waiting)} waiting`} className="m-0 flex list-none flex-col gap-2 p-0">
                  {group.items.map(card)}
                </ul>
              </li>
            ) : (
              group.items.map(card)
            ),
          )}
    </ul>
  );
}
