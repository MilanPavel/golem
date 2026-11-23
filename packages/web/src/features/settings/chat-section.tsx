import { DETAILS, type Detail, type FooterPart } from "@golem/view";
import { useMemo, type ReactNode } from "react";
import { modShortcut } from "../../ui/platform.ts";
import { Kbd } from "../../ui/kbd.tsx";
import { cn } from "../../ui/cn.ts";
import {
  ActivityLine,
  EditCards,
  Markdown,
  ThinkingLine,
  setDetail,
  setFooter,
  setSendKey,
  setThinkingMode,
  THINKING_MODES,
  useDetail,
  useFooter,
  useSendKey,
  useThinkingMode,
  type SendKey,
  type ThinkingMode,
} from "../chat/index.ts";
import { previewChat } from "../chat/preview-sample.ts";
import { sendHint } from "../composer/send-hint.ts";
import { YourInstructions } from "./chat-instructions.tsx";
import { HowFarItGoesAlone } from "./chat-alone.tsx";
import { Choice } from "./chat-controls.tsx";
import { FooterChips, FooterSample, sampleFooter } from "./chat-footer.tsx";
import { Stage, YouRow } from "./chat-stage.tsx";

const DETAIL_LABELS: Record<Detail, string> = { quiet: "Quiet", normal: "Normal", verbose: "Verbose" };
const THINKING_LABELS: Record<ThinkingMode, string> = { hidden: "Hidden", collapsed: "Collapsed", open: "Open" };

/** One row of stage 3: a piece of the sample turn on the left, and on the right the control that changes it. Below the `chat` width the note goes under the piece. */
function Piece({ setting, piece, note, marked = true }: { setting?: string; piece: ReactNode; note?: ReactNode; marked?: boolean }) {
  return (
    <li data-setting={setting} className={cn("flex flex-col gap-2 px-4 py-2.5 chat:flex-row chat:items-start chat:gap-5", marked && "border-y border-dashed border-line bg-surface/70")}>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">{piece}</div>
      {note === undefined ? null : <div className="flex flex-col items-start gap-2 border-l-2 border-clay pl-3 text-xs text-muted chat:w-chat-note chat:shrink-0">{note}</div>}
    </li>
  );
}

function NoteLabel({ children }: { children: string }) {
  return <span className="text-meta font-medium tracking-wide text-faint uppercase">{children}</span>;
}

/** What the chat shows: a sample answer, and beside each piece the screen choice that changes it. They are kept in this browser. */
function WhatTheChatShows() {
  const detail = useDetail();
  const thinking = useThinkingMode();
  const footer = useFooter();
  const sendKey = useSendKey();
  const turn = useMemo(() => previewChat(), []);
  const answer = turn.messages.find((message) => message.role === "assistant");
  const steps = useMemo(() => (answer === undefined ? [] : [answer]), [answer]);
  const source = useMemo(() => sampleFooter(steps), [steps]);
  if (answer === undefined) return null;
  const tools = answer.tools ?? [];
  const toggle = (part: FooterPart): void => {
    setFooter({ ...footer, off: footer.off.includes(part) ? footer.off.filter((item) => item !== part) : [...footer.off, part] });
  };
  return (
    <ul aria-label="What you see" className="m-0 flex list-none flex-col rounded-lg border border-line bg-bg py-1.5 pl-0">
      <Piece
        setting="thinking"
        piece={
          thinking === "hidden" ? (
            // eslint-disable-next-line golem/no-font-mono -- it stands in for the thinking line, which is mono
            <span className="inline-block rounded-md border border-dashed border-line-strong px-2 py-0.5 font-mono text-xs text-faint opacity-75">thinking is hidden</span>
          ) : (
            <div key={thinking} className="w-full">
              <ThinkingLine message={answer} />
            </div>
          )
        }
        note={
          <>
            <NoteLabel>Thinking</NoteLabel>
            <Choice label="Thinking" value={thinking} onPick={setThinkingMode} choices={THINKING_MODES.map((mode) => ({ value: mode, label: THINKING_LABELS[mode] }))} />
          </>
        }
      />
      <Piece
        marked={false}
        piece={
          <>
            <div className="prose">
              <Markdown text={answer.text} streaming={false} />
            </div>
            <div className="w-full min-w-0">
              <EditCards tools={tools.filter((tool) => tool.name === "write_file")} />
            </div>
          </>
        }
      />
      <Piece
        setting="steps"
        piece={
          <div key={detail} className="w-full">
            <ActivityLine tools={tools} detail={detail} />
          </div>
        }
        note={
          <>
            <NoteLabel>Steps</NoteLabel>
            <Choice label="Steps" value={detail} onPick={setDetail} choices={DETAILS.map((level) => ({ value: level, label: DETAIL_LABELS[level] }))} />
            <span>Verbose shows every step open. An approval always opens it.</span>
          </>
        }
      />
      <Piece
        setting="footer"
        piece={
          <>
            <FooterSample source={source} choice={footer} detail={detail} />
            <FooterChips source={source} choice={footer} detail={detail} onToggle={toggle} />
          </>
        }
        note={
          <>
            <NoteLabel>The line under each answer</NoteLabel>
            <span>Click a part to show or hide it. The line above is what a chat shows.</span>
            <label className="flex items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={footer.leaveOutEmpty}
                onChange={(event) => {
                  setFooter({ ...footer, leaveOutEmpty: event.target.checked });
                }}
                className="accent-clay"
              />
              <span>Leave out what says nothing</span>
            </label>
          </>
        }
      />
      <Piece
        setting="send"
        piece={
          <div className="flex w-full flex-col gap-1.5 rounded-xl border border-line-strong bg-bg py-2.5 pr-3 pl-4">
            <p className="text-sm text-muted">Make Sunday shorter</p>
            <p className="text-meta text-faint">{sendHint(sendKey, false)}</p>
          </div>
        }
        note={
          <>
            <NoteLabel>Send with</NoteLabel>
            <Choice<SendKey>
              label="Send with"
              value={sendKey}
              onPick={setSendKey}
              choices={[
                { value: "enter", name: "Enter", label: <Kbd>↵</Kbd> },
                { value: "mod", name: modShortcut("Enter"), label: <Kbd>{modShortcut("↵")}</Kbd> },
              ]}
            />
            <span>The other key adds a new line.</span>
          </>
        }
      />
    </ul>
  );
}

/** Settings › Chat as one chat turn: what golem reads, how far it goes alone, and what you see. The screen choices are kept in this browser; the rest are saved in the config. */
export function ChatSection({ instructions = <YourInstructions />, alone = <HowFarItGoesAlone /> }: { instructions?: ReactNode; alone?: ReactNode }) {
  return (
    <div className="flex w-full max-w-chat-page flex-col">
      <Stage number={1} title="Before you write" hint="golem puts these lines in every chat, word for word">
        {instructions}
      </Stage>
      <YouRow>Plan a weekend in Porto and save it to my notes</YouRow>
      <Stage number={2} title="While it works" hint="how far it goes before it checks with you">
        {alone}
      </Stage>
      <Stage number={3} title="What you see" hint="only this screen, saved on this device; the answer does not change" last>
        <WhatTheChatShows />
      </Stage>
    </div>
  );
}
