import { useId, useState } from "react";
import { TranscriptMessages, useDetail, useFooter, useOpenOnFail, useSendKey, useThinkingMode } from "../chat/index.ts";
import { previewChat } from "../chat/preview-sample.ts";
import { sendHint } from "../composer/send-hint.ts";
import { Switch } from "./chat-controls.tsx";

/**
 * One turn in today's layout with the page's choices applied, drawn by the real transcript from sample data:
 * the question, the golem, thinking, the answer, the steps line with its rows, the line under the answer, and
 * the composer's send hint. The switch shows the case of a failed step.
 */
export function ChatPreview() {
  const [failed, setFailed] = useState(false);
  const labelId = useId();
  const detail = useDetail();
  const thinking = useThinkingMode();
  const openOnFail = useOpenOnFail();
  const footer = useFooter();
  const sendKey = useSendKey();
  return (
    <div role="group" aria-label="Preview" className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface chat:sticky chat:top-0 chat:w-chat-preview chat:shrink-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2.5">
        <h4 className="text-meta font-medium text-faint">Preview</h4>
        <span className="flex items-center gap-2">
          <span id={labelId} className="text-xs text-muted">
            One step failed
          </span>
          <Switch
            labelledBy={labelId}
            checked={failed}
            onToggle={() => {
              setFailed((value) => !value);
            }}
          />
        </span>
      </div>
      <div className="flex flex-col gap-3 px-3.5 py-3">
        {/* A new choice starts the turn afresh, so a line the person opened by hand does not hide what the choice does. */}
        <TranscriptMessages key={`${detail}|${thinking}|${openOnFail}|${footer.leaveOutEmpty}|${failed}`} chat={previewChat(failed)} />
        <div className="flex flex-col gap-1.5 rounded-xl border border-line-strong bg-bg py-2.5 pr-3 pl-4">
          <p className="text-sm text-muted">Make Sunday shorter</p>
          <p className="text-meta text-faint">{sendHint(sendKey, false)}</p>
        </div>
      </div>
    </div>
  );
}
