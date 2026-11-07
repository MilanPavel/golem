import {
  applyComposer,
  guided,
  OVERVIEW,
  closedDebug,
  COMMANDS,
  copyAnswer,
  copyCode,
  exportFileName,
  forkPoint,
  invocableSkills,
  modelNames,
  namesModel,
  pickerName,
  pinnableSkills,
  sessionMarkdown,
  withModelChoices,
  withSkillChoices,
  type Command,
  type ComposerOutcome,
} from "@golem/view";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { actionErrorText, isNoModelChosen } from "../../store/errors.ts";
import { useModelList, useNavigate, useNewSessionModel, usePageActions, useSessionReader, useSkillList } from "../../store/page-context.tsx";
import { setTimesShown, timesShownStore } from "../chat/index.ts";
import { drawerOpenStore, useDrawerOpen } from "../drawer/index.ts";
import { openModelDialog } from "../models/index.ts";
import { openSetup, startNoticeStore, useStartNotice } from "../setup/index.ts";
import { CloseSessionDialog, useSessionActions } from "../sessions/index.ts";
import { writeClipboard } from "../../ui/clipboard.ts";
import { downloadText } from "./copy-text.ts";
import { CommandsDialog } from "./help-dialog.tsx";
import type { CommandNotice } from "./notice-line.tsx";
import { settingsPath } from "../../store/router.ts";
import { requestMcpAdd } from "../settings/mcp-add-request.ts";
import { NEEDS_SESSION, NOT_YET } from "./terminal-only.ts";

/**
 * What a run came to. "sent" went to the daemon; "handled" was a command the page ran; "busy" is
 * a message or skill that a run in progress holds back, so the draft stays.
 */
export type RunResult = "sent" | "handled" | "busy";

const NONE: readonly string[] = [];

export type UseCommandsOptions = {
  /** The session the composer belongs to, or null on the empty screen. `active` is what it has pinned. */
  session: { id: string; active: readonly string[] } | null;
  /** The folder whose skills `/` suggests: the session's, or the one a new session would get. */
  cwd: string | null;
  /** The draft starts with `/`: only then are the model and skill lists fetched. */
  typing: boolean;
  /** Sends a message, or runs a skill once, in the session (the empty screen starts one). */
  send: (text: string, skill?: { name: string; args: string }) => Promise<void>;
};

export type Commands = {
  /** Runs a draft: a message, or a command. A send that fails rejects, so the composer keeps the text. */
  run: (raw: string) => Promise<RunResult>;
  /** The commands for the suggestions, with the model and skill choices filled in. */
  registry: readonly Command[];
  notice: CommandNotice | null;
  /** A command that failed, for the error line. */
  error: string | null;
  /** Forget the notice and the error, as when the draft changes. */
  clear: () => void;
  /** The dialogs a command opens: Commands, the close question, and the model dialog's host is the screen. */
  dialogs: ReactNode;
};

/**
 * What Enter does with a draft in the composer, as in the terminal: `applyComposer` reads the
 * line and this runs the outcome. Each command either does its work, opens the dialog that does,
 * or says where it lives when the page has no way to do it yet.
 */
export function useCommands({ session, cwd, typing, send }: UseCommandsOptions): Commands {
  const sessionId = session?.id ?? null;
  const actions = usePageActions();
  const navigate = useNavigate();
  const [, chooseModel] = useNewSessionModel();
  const sessionActions = useSessionActions();
  const read = useSessionReader(sessionId);
  const models = useModelList(typing);
  const skills = useSkillList(cwd, typing);
  const [, setDrawerOpen] = useDrawerOpen();
  const [ownNotice, setNotice] = useState<CommandNotice | null>(null);
  const startNotice = useStartNotice();
  const notice = ownNotice ?? (startNotice === null ? null : { text: startNotice });
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);
  /** The element with focus now, which is the composer: a dialog opened by a command gives focus back to it. */
  const focused = (): HTMLElement | null => (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const giveFocusBack = (event: Event): void => {
    event.preventDefault();
    returnTo.current?.focus();
  };
  const [closing, setClosing] = useState(false);

  const active = session?.active ?? NONE;
  const registry = useMemo(() => {
    const listed = skills.data?.skills ?? [];
    return withSkillChoices(withModelChoices(COMMANDS, modelNames(models.data ?? null)), invocableSkills(listed), {
      pinnable: pinnableSkills(listed),
      active,
    });
  }, [skills.data, models.data, active]);

  const latest = useRef({ send, skills, models, cwd });
  useEffect(() => {
    latest.current = { send, skills, models, cwd };
  });

  const clear = useCallback(() => {
    startNoticeStore.set(null);
    setNotice(null);
    setError(null);
  }, []);

  const run = useCallback(
    async (raw: string): Promise<RunResult> => {
      const { send: sendMessage, skills: skillQuery, models: modelQuery } = latest.current;
      clear();
      const line = raw.trim();
      let listed = skillQuery.data?.skills;
      if (listed === undefined && line.startsWith("/") && !line.startsWith("//")) {
        // The list is fetched as the draft starts with a slash; a pasted command may be faster.
        listed = (await skillQuery.refetch()).data?.skills;
      }
      const { view, summary } = read();
      const pins = { pinnable: pinnableSkills(listed ?? []), active: view.chat.activeSkills };
      const outcome = applyComposer(closedDebug, raw, invocableSkills(listed ?? []), pins);

      const say = (text: string, command?: string): RunResult => {
        setNotice(command === undefined ? { text } : { text, command });
        return "handled";
      };
      const fail = (err: unknown, fallback: string): RunResult => {
        setError(actionErrorText(err, fallback));
        return "handled";
      };
      const title = view.title ?? summary?.title ?? null;

      async function runOutcome(found: Exclude<ComposerOutcome, { kind: "idle" | "send" | "skill" }>): Promise<RunResult> {
        switch (found.kind) {
          case "unknown":
            return say(found.notice);
          case "help":
            returnTo.current = focused();
            setHelpOpen(true);
            return "handled";
          case "mcp":
            navigate(settingsPath("mcp"));
            return "handled";
          case "mcp-add":
            requestMcpAdd(found.id);
            navigate(settingsPath("mcp"));
            return "handled";
          case "skills":
            return say(NOT_YET.skills);
          case "permissions":
            navigate(settingsPath("rules"));
            return "handled";
          case "artifact":
            return say(NOT_YET.artifact);
          case "setup":
            openSetup({ window: OVERVIEW, returnTo: focused() });
            return "handled";
          case "sessions":
            return say(NOT_YET.sessions);
          case "login":
            return say("Keys are set in a terminal:", `golem auth set ${found.provider ?? "<provider>"}`);
          case "logout":
            return say("Keys are set in a terminal:", `golem auth remove ${found.provider}`);
          case "local":
            // `/skill` alone and its notices carry text; a debug command has none.
            return say(found.notice ?? NOT_YET.debug);
          case "time": {
            const next = !timesShownStore.getSnapshot();
            setTimesShown(next);
            return say(next ? "Times shown." : "Times hidden.");
          }
          case "new":
            if (sessionId !== null) navigate("/");
            return "handled";
          default:
            break;
        }
        if (sessionId === null && found.kind === "model") {
          // The empty screen has no session: the model is the next new session's.
          if (found.name === null) {
            openModelDialog({ sessionId: null, returnTo: focused() });
            return "handled";
          }
          const named = found.name;
          const listing = modelQuery.data ?? (await modelQuery.refetch()).data;
          const model = listing?.models.find((item) => namesModel(item, named) || item.ref === `ollama/${named}`);
          if (model === undefined) {
            return say(`No model named ${named}. /model lists them.`);
          }
          if (model.status !== "ready") {
            return say(`${model.label} is not ready. /model opens the list, where it can be downloaded.`);
          }
          chooseModel(pickerName(model));
          return say(`New sessions use ${model.label}.`);
        }
        if (sessionId === null) {
          return say(NEEDS_SESSION);
        }
        switch (found.kind) {
          case "mcp-toggle":
            try {
              await actions.toggleMcp(sessionId, found.name, found.on);
              return say(`${found.name} is ${found.on ? "on" : "off"} for this chat.`);
            } catch (err) {
              return fail(err, `Could not turn ${found.name} ${found.on ? "on" : "off"}.`);
            }
          case "todos": {
            const next = !drawerOpenStore.getSnapshot();
            setDrawerOpen(next);
            return say(next ? "Todos shown." : "Todos hidden.");
          }
          case "skill-pin":
            try {
              await actions.pinSkill(sessionId, found.name, found.pin);
              return say(found.pin ? `Pinned ${found.name}.` : `Unpinned ${found.name}.`);
            } catch (err) {
              return fail(err, found.pin ? `Could not pin ${found.name}.` : `Could not unpin ${found.name}.`);
            }
          case "fork": {
            const at = forkPoint(view.chat.messages);
            if (at === null) {
              return say("Nothing to fork yet.");
            }
            try {
              await sessionActions.fork(sessionId, at);
              return "handled";
            } catch (err) {
              return fail(err, "Could not fork the session.");
            }
          }
          case "title":
            if (found.title === null) {
              return say(title === null || title === "" ? "No title yet." : `Title: ${title}`);
            }
            try {
              await sessionActions.rename(sessionId, found.title);
              return say("Renamed.");
            } catch (err) {
              return fail(err, "Could not rename the session.");
            }
          case "close-session":
            returnTo.current = focused();
            setClosing(true);
            return "handled";
          case "copy": {
            const text = found.code ? copyCode(view.chat.messages) : copyAnswer(view.chat.messages);
            if (text === null) {
              return say(found.code ? "No code block in the last answer." : "Nothing to copy yet.");
            }
            try {
              await writeClipboard(text);
              return say(found.code ? "Copied the last code block." : "Copied the last answer.");
            } catch (err) {
              return fail(err, "Could not copy to the clipboard.");
            }
          }
          case "export": {
            const file = exportFileName(title ?? "");
            try {
              downloadText(file, sessionMarkdown(title ?? "", view.chat.messages));
            } catch (err) {
              return fail(err, "Could not save the file.");
            }
            return say(found.path === null ? `Downloaded ${file}.` : `The page saves to your downloads: ${file}.`);
          }
          case "model":
            if (found.name === null) {
              openModelDialog({ sessionId, returnTo: focused() });
              return "handled";
            }
            try {
              await actions.useModel(sessionId, found.name);
              return say(`Switched to ${found.name}.`);
            } catch (err) {
              return fail(err, "Could not switch the model.");
            }
          case "model-pull":
          case "model-rm": {
            const listing = modelQuery.data ?? (await modelQuery.refetch()).data;
            const named = found.name;
            const model = listing?.models.find((item) => item.ref === named || item.ref === `ollama/${named}`);
            if (model === undefined) {
              return say(`No local model named ${named}. /model lists them.`);
            }
            openModelDialog({
              sessionId,
              returnTo: focused(),
              initial: {
                activeId: model.ref,
                confirm:
                  found.kind === "model-pull" ? { kind: "pull", ref: model.ref, step: 1 } : { kind: "remove", ref: model.ref },
              },
            });
            return "handled";
          }
          default:
            return "handled";
        }
      }

      if (outcome.kind === "idle") {
        return "handled";
      }
      if (outcome.kind === "send" || outcome.kind === "skill") {
        if (view.chat.busy) {
          return "busy";
        }
        try {
          await sendMessage(outcome.text, outcome.kind === "skill" ? { name: outcome.name, args: outcome.args } : undefined);
        } catch (err) {
          // No model chosen yet: setup picks one. The draft stays, and goes when Enter is pressed again.
          if (isNoModelChosen(err)) openSetup({ window: guided("engine", "send"), returnTo: focused() });
          throw err;
        }
        return "sent";
      }
      return runOutcome(outcome);
    },
    [actions, chooseModel, clear, navigate, read, sessionActions, sessionId, setDrawerOpen],
  );

  const dialogs = (
    <>
      <CommandsDialog open={helpOpen} onOpenChange={setHelpOpen} commands={COMMANDS} onCloseAutoFocus={giveFocusBack} />
      {sessionId === null ? null : (
        <CloseSessionDialog
          open={closing}
          onOpenChange={setClosing}
          onConfirm={() => sessionActions.close(sessionId)}
          onCloseAutoFocus={giveFocusBack}
        />
      )}
    </>
  );

  return { run, registry, notice, error, clear, dialogs };
}
