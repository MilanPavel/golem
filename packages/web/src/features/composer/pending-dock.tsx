import { inboxAnswerOptions, type ApprovalAnswerOption, type InboxItem } from "@golem/view";
import { useCallback, useMemo, useState } from "react";
import { inboxKey, useInbox } from "../../store/inbox.ts";
import { useDraftReader, useNavigate } from "../../store/page-context.tsx";
import { helperPath } from "../../store/router.ts";
import { DockCounter } from "../approval/dock-counter.tsx";
import { DockedApproval } from "../approval/docked-approval.tsx";
import { HelperQuestion } from "../approval/helper-question.tsx";
import { useOptionKeys } from "../approval/use-option-keys.ts";
import { HelperConsent } from "../consent/helper-consent.tsx";
import { DockedConsent } from "../consent/docked-consent.tsx";

/**
 * What the lead waits for, above its composer: its own approval or paid question, and those of its helpers, one at
 * a time with "1 of 2" and previous and next. A lead whose helpers ask nothing (or an older daemon, which sends no
 * `pending_items`) shows its own cards as before. The answer goes through the Inbox's store, so the Inbox and the
 * dock show the same state: both clear when the lead's next summary says the question is answered.
 */
export function PendingDock({ sessionId }: { sessionId: string }) {
  const inbox = useInbox();
  const navigate = useNavigate();
  const readDraft = useDraftReader(sessionId);
  const items = useMemo(() => inbox.items.filter((item) => item.sessionId === sessionId), [inbox.items, sessionId]);
  const [picked, setPicked] = useState<string | null>(null);
  const found = items.findIndex((item) => inboxKey(item) === picked);
  const index = Math.max(0, found);
  const current: InboxItem | undefined = items[index];
  const asks = current?.helper !== null && current?.helper !== undefined && current.kind === "approval" ? current : null;
  const busy = asks !== null && inbox.busy[inboxKey(asks)] === true;
  const choose = useCallback(
    (option: ApprovalAnswerOption) => {
      if (asks === null) return;
      if (option.scope === undefined) inbox.answer(asks, option.decision);
      else inbox.answer(asks, option.decision, option.scope);
    },
    [asks, inbox],
  );
  useOptionKeys({
    options: asks === null || busy ? [] : inboxAnswerOptions(asks),
    canAnswer: () => readDraft() === "",
    onChoose: choose,
  });
  const openHelper = useCallback(
    (item: InboxItem) => {
      if (item.helper !== null) navigate(helperPath(item.helper.sessionId, item.sessionId));
    },
    [navigate],
  );

  if (current === undefined || !items.some((item) => item.helper !== null)) {
    return (
      <>
        <DockedApproval sessionId={sessionId} />
        <DockedConsent sessionId={sessionId} />
      </>
    );
  }
  const key = inboxKey(current);
  let card;
  if (current.helper === null) {
    card = current.kind !== "consent" ? <DockedApproval sessionId={sessionId} /> : <DockedConsent sessionId={sessionId} />;
  } else if (current.kind === "consent") {
    card = <HelperConsent key={key} item={current} onOpen={openHelper} />;
  } else {
    card = (
      <HelperQuestion
        key={key}
        item={current}
        sending={busy}
        error={inbox.errors[key] ?? null}
        onAnswer={choose}
        onOpen={openHelper}
      />
    );
  }
  return (
    <>
      <DockCounter
        index={index}
        total={items.length}
        onPick={(next) => {
          const target = items[next];
          if (target !== undefined) setPicked(inboxKey(target));
        }}
      />
      {card}
    </>
  );
}
