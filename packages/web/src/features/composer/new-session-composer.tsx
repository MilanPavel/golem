import { useConnection } from "../../store/connection-context.tsx";
import { useNewSessionFolder, useDraft, useDraftPastes } from "../../store/page-context.tsx";
import { Composer } from "./composer.tsx";
import { browserHistory } from "./history.ts";
import { NoticeLine } from "./notice-line.tsx";
import { NEW_DRAFT_KEY, type useStartSession } from "./start-session.ts";
import { useCommands } from "./use-commands.tsx";

/** The large composer of the empty screen. Its draft is kept under "new". */
export function NewSessionComposer({ start }: { start: ReturnType<typeof useStartSession> }) {
  const connection = useConnection().state.status;
  const [text, setText] = useDraft(NEW_DRAFT_KEY);
  const [pastes, setPastes] = useDraftPastes(NEW_DRAFT_KEY);
  const [folder] = useNewSessionFolder();
  const commands = useCommands({ session: null, cwd: folder, typing: text.startsWith("/"), send: start.send });
  const error = commands.error ?? start.error;
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
        onSend={commands.run}
        commands={commands.registry}
        onEdit={commands.clear}
        clear="on-success"
        pending={start.pending}
        disabledReason={connection === "connected" ? null : "Not connected to golem"}
        autoFocus
      />
      {error ? (
        <p role="alert" className="px-1 text-left text-xs text-deny">
          {error}
        </p>
      ) : null}
      {commands.notice === null ? null : (
        <div className="text-left">
          <NoticeLine notice={commands.notice} />
        </div>
      )}
      {commands.dialogs}
    </div>
  );
}
