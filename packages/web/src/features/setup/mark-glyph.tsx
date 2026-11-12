import type { Mark } from "@golem/view";
import { CheckIcon } from "../../ui/icons.tsx";
import "./setup.css";

/** What a mark means in words, so colour is never the only signal. */
const MARK_WORDS: Record<Mark, string> = { ok: "done", fail: "failed", attn: "needs attention", spin: "working" };

/** The mark of a line with its word for a screen reader. The Settings form uses it for its cards too. */
export function MarkGlyph({ mark }: { mark: Mark }) {
  const word = <span className="sr-only">{MARK_WORDS[mark]}: </span>;
  switch (mark) {
    case "ok":
      return (
        <span className="grid size-4 shrink-0 place-items-center text-allow">
          <CheckIcon />
          {word}
        </span>
      );
    case "fail":
      return (
        <span className="grid size-4 shrink-0 place-items-center font-mono text-sm leading-none text-deny">
          <span aria-hidden="true">✗</span>
          {word}
        </span>
      );
    case "attn":
      return (
        <span className="grid size-4 shrink-0 place-items-center font-mono text-sm leading-none font-semibold text-wait">
          <span aria-hidden="true">!</span>
          {word}
        </span>
      );
    case "spin":
      return (
        <span className="grid size-4 shrink-0 place-items-center">
          <span aria-hidden="true" className="setup-pulse size-2 bg-clay" />
          {word}
        </span>
      );
  }
}
