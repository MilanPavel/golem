import { useConnection } from "../../store/connection-context.tsx";
import { useDraft, useDraftPastes } from "../../store/page-context.tsx";
import { Composer } from "./composer.tsx";
import { browserHistory } from "./history.ts";
import { NEW_DRAFT_KEY, type useStartSession } from "./start-session.ts";

/** The large composer of the empty screen. Its draft is kept under "new". */
export function NewSessionComposer({ start }: { start: ReturnType<typeof useStartSession> }) {
  const connection = useConnection().state.status;
  const [text, setText] = useDraft(NEW_DRAFT_KEY);
  const [pastes, setPastes] = useDraftPastes(NEW_DRAFT_KEY);
  return (
    <div className="flex w-full flex-col gap-1.5">
      <Composer
        size="large"
        label="Message"
        placeholder='Try "explain this repo"'
        text={text}
        onTextChange={setText}
        pastes={pastes}
        onPastesChange={setPastes}
        history={browserHistory}
        onSend={start.send}
        clear="on-success"
        pending={start.pending}
        disabledReason={connection === "connected" ? null : "Not connected to golem"}
        autoFocus
      />
      {start.error ? (
        <p role="alert" className="px-1 text-left text-xs text-deny">
          {start.error}
        </p>
      ) : null}
    </div>
  );
}
