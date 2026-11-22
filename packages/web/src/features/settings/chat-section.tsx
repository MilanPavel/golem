import { DETAILS, FOOTER_PART_LABELS, FOOTER_PARTS, type Detail, type FooterPart } from "@golem/view";
import { useId, type ReactNode } from "react";
import { modShortcut } from "../../ui/platform.ts";
import { Kbd } from "../../ui/kbd.tsx";
import {
  setDetail,
  setFooter,
  setOpenOnFail,
  setSendKey,
  setThinkingMode,
  THINKING_MODES,
  useDetail,
  useFooter,
  useOpenOnFail,
  useSendKey,
  useThinkingMode,
  type SendKey,
  type ThinkingMode,
} from "../chat/index.ts";
import { YourInstructions } from "./chat-instructions.tsx";
import { HowFarItGoesAlone } from "./chat-alone.tsx";
import { ChatPreview } from "./chat-preview.tsx";
import { ChatRow, Choice, PartChip, Switch } from "./chat-controls.tsx";

const DETAIL_LABELS: Record<Detail, string> = { quiet: "Quiet", normal: "Normal", verbose: "Verbose" };
const THINKING_LABELS: Record<ThinkingMode, string> = { hidden: "Hidden", collapsed: "Collapsed", open: "Open" };

/** What the chat shows: the screen choices, with a preview of one turn beside them. They are kept in this browser. */
function WhatTheChatShows() {
  const detail = useDetail();
  const thinking = useThinkingMode();
  const openOnFail = useOpenOnFail();
  const footer = useFooter();
  const sendKey = useSendKey();
  const id = useId();
  const toggle = (part: FooterPart): void => {
    setFooter({ ...footer, off: footer.off.includes(part) ? footer.off.filter((item) => item !== part) : [...footer.off, part] });
  };
  return (
    <section aria-labelledby={`${id}-head`} className="flex flex-col gap-3">
      <div className="flex max-w-column flex-col gap-1">
        <h3 id={`${id}-head`} className="text-base font-semibold text-ink">
          What the chat shows
        </h3>
        <p className="text-sm text-muted">Only your screen; the answer does not change. Saved on this device.</p>
      </div>
      <div className="flex flex-col items-stretch gap-5 chat:flex-row chat:items-start">
        <ul aria-label="What the chat shows" className="m-0 flex min-w-0 flex-1 list-none flex-col rounded-lg border border-line bg-surface px-4 py-1">
          <ChatRow
            setting="steps"
            label="Steps"
            labelId={`${id}-steps`}
            control={<Choice label="Steps" value={detail} onPick={setDetail} choices={DETAILS.map((level) => ({ value: level, label: DETAIL_LABELS[level] }))} />}
          >
            The line at the end of each answer. Quiet: just a count. Normal: what it did, folded. Verbose: every step open. An approval always opens it.
          </ChatRow>
          <ChatRow
            setting="open it when a step fails"
            label="Open it when a step fails"
            labelId={`${id}-fail`}
            control={<Switch labelledBy={`${id}-fail`} checked={openOnFail} onToggle={() => { setOpenOnFail(!openOnFail); }} />}
          >
            So a failed command or a refused call never hides behind a fold, even in Quiet.
          </ChatRow>
          <ChatRow
            setting="thinking"
            label="Thinking"
            labelId={`${id}-thinking`}
            control={<Choice label="Thinking" value={thinking} onPick={setThinkingMode} choices={THINKING_MODES.map((mode) => ({ value: mode, label: THINKING_LABELS[mode] }))} />}
          >
            For models that think before they answer. Collapsed shows “thought for 3s” and opens on a click. Open shows the text too.
          </ChatRow>
          <ChatRow
            setting="footer"
            label="The line under each answer"
            labelId={`${id}-footer`}
            stacked
            control={
              <div className="mt-1 flex flex-col gap-2.5">
                <div role="group" aria-labelledby={`${id}-footer`} className="flex flex-wrap gap-1.5">
                  {FOOTER_PARTS.map((part) => (
                    <PartChip
                      key={part}
                      on={!footer.off.includes(part)}
                      onToggle={() => {
                        toggle(part);
                      }}
                    >
                      {FOOTER_PART_LABELS[part]}
                    </PartChip>
                  ))}
                </div>
                <label className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={footer.leaveOutEmpty}
                    onChange={(event) => {
                      setFooter({ ...footer, leaveOutEmpty: event.target.checked });
                    }}
                    className="mt-0.5 accent-clay"
                  />
                  <span>
                    Leave out what says nothing <span className="text-muted">(“$0.00” on a local model, a step count that Quiet already shows)</span>
                  </span>
                </label>
              </div>
            }
          >
            Pick the parts you want. ↑ stronger model is an action, not a part, so it shows whenever it can help.
          </ChatRow>
          <ChatRow
            setting="send"
            label="Send with"
            labelId={`${id}-send`}
            control={
              <Choice<SendKey>
                label="Send with"
                value={sendKey}
                onPick={setSendKey}
                choices={[
                  { value: "enter", name: "Enter", label: <Kbd>↵</Kbd> },
                  { value: "mod", name: modShortcut("Enter"), label: <Kbd>{modShortcut("↵")}</Kbd> },
                ]}
              />
            }
          >
            The other key adds a new line.
          </ChatRow>
        </ul>
        <ChatPreview />
      </div>
    </section>
  );
}

/** Settings › Chat: how golem answers and what a chat shows. This page has the screen choices; they apply to every chat. */
export function ChatSection({ instructions = <YourInstructions />, alone = <HowFarItGoesAlone /> }: { instructions?: ReactNode; alone?: ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      {instructions}
      {alone}
      <WhatTheChatShows />
    </div>
  );
}
