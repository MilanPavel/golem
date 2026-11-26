import "./code-editor.css";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../ui/cn.ts";

/** What the text is written in. */
type Language = "toml" | "markdown" | "python";

type Token = { content: string; color?: string | undefined; fontStyle?: number | undefined };

const ITALIC = 1;
const BOLD = 2;

/** The text as coloured lines, once Shiki has loaded. Until then, and for a grammar that fails, there are none. */
function useTokens(text: string, language: Language): readonly (readonly Token[])[] | null {
  const [tokens, setTokens] = useState<{ text: string; lines: readonly (readonly Token[])[] } | null>(null);
  useEffect(() => {
    let live = true;
    void import("../../chat/highlight-engine.ts")
      .then(({ tokenize }) => tokenize(text, language))
      .then(
        (lines) => {
          if (live) setTokens({ text, lines });
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [text, language]);
  // Tokens of an older text would be drawn out of place, so they show only for the text they came from.
  return tokens !== null && tokens.text === text ? tokens.lines : null;
}

/**
 * A text box for TOML or Markdown: line numbers, colours, and a mark on the lines with a problem. The colours
 * are a copy of the text drawn under a transparent textarea, which keeps the browser's own editing,
 * selection, undo, and screen-reader support. Lines do not wrap, so a line is a line in both.
 */
export function CodeEditor({
  value,
  onChange,
  marked,
  label,
  language = "toml",
  readOnly = false,
  markKind = "problem",
  problems,
  stepNumbers,
  bands,
  onCursor,
  reveal,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Line numbers (from 1) with a problem. */
  marked: ReadonlySet<number>;
  label: string;
  language?: Language;
  readOnly?: boolean;
  /** What a marked line is: `problem` (a cross, in deny) or `step` (a dot, in clay: where a workflow step starts). */
  markKind?: "problem" | "step";
  /** Lines (from 1) with a problem. They show a cross over any other mark. */
  problems?: ReadonlySet<number>;
  /** Line to step number: a step's line shows its number in the margin instead of a dot. */
  stepNumbers?: ReadonlyMap<number, number>;
  /** Lines (from 1) tinted behind the text: the selected step, or a problem. */
  bands?: readonly { from: number; to: number; kind: "step" | "problem" }[];
  /** The caret moved: its line (from 1). */
  onCursor?: (line: number) => void;
  /** Scrolls this line into view whenever `nonce` changes. */
  reveal?: { line: number; nonce: number };
  /** Replaces the default sizing: fills the free height of its parent, at least `min-h-72`. */
  className?: string;
}) {
  const tokens = useTokens(value, language);
  const under = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const count = value.split("\n").length;
  const area = useRef<HTMLTextAreaElement>(null);
  const nonce = reveal?.nonce;
  const revealLine = reveal?.line;
  useEffect(() => {
    const box = area.current;
    if (box === null || nonce === undefined || revealLine === undefined) return;
    const height = Number.parseFloat(getComputedStyle(box).lineHeight) || 20;
    box.scrollTop = Math.max(0, (revealLine - 3) * height);
  }, [nonce, revealLine]);

  function cursor(event: { currentTarget: HTMLTextAreaElement }): void {
    if (onCursor === undefined) return;
    const { value: text, selectionStart } = event.currentTarget;
    onCursor(text.slice(0, selectionStart).split("\n").length);
  }

  function follow(event: React.UIEvent<HTMLTextAreaElement>): void {
    const { scrollTop, scrollLeft } = event.currentTarget;
    if (under.current !== null) {
      under.current.scrollTop = scrollTop;
      under.current.scrollLeft = scrollLeft;
    }
    if (gutter.current !== null) gutter.current.scrollTop = scrollTop;
  }

  return (
    <div className={cn("code-editor flex min-h-72 flex-1 overflow-hidden rounded-md border border-line-strong bg-surface focus-within:border-clay", className)}>
      <div
        ref={gutter}
        aria-hidden="true"
        className="code-editor-layer overflow-hidden border-r border-line text-right text-faint select-none"
      >
        {Array.from({ length: count }, (_, at) => (
          <div key={at} className={cn((problems?.has(at + 1) ?? false) ? "font-semibold text-deny" : marked.has(at + 1) && (markKind === "step" ? "font-semibold text-clay-ink" : "font-semibold text-deny"))}>
            {problems?.has(at + 1) ? "✘" : stepNumbers?.has(at + 1) ? `${stepNumbers.get(at + 1)} ●` : marked.has(at + 1) ? (markKind === "step" ? "●" : "✘") : ""}
            {at + 1}
          </div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        {(bands ?? []).map((band, at) => (
          <div
            key={at}
            aria-hidden="true"
            className="code-editor-band"
            data-kind={band.kind}
            style={{ top: `${0.5 + (band.from - 1) * 1.25}rem`, height: `${(band.to - band.from + 1) * 1.25}rem` }}
          />
        ))}
        <pre ref={under} aria-hidden="true" className="code-editor-layer absolute inset-0 overflow-hidden text-ink">
          {tokens === null
            ? value
            : tokens.map((line, at) => (
                <span key={at}>
                  {line.map((token, index) => (
                    <span
                      key={index}
                      style={{
                        ...(token.color ? { color: token.color } : {}),
                        ...(token.fontStyle !== undefined && token.fontStyle & ITALIC ? { fontStyle: "italic" } : {}),
                        ...(token.fontStyle !== undefined && token.fontStyle & BOLD ? { fontWeight: 600 } : {}),
                      }}
                    >
                      {token.content}
                    </span>
                  ))}
                  {at < tokens.length - 1 ? "\n" : ""}
                </span>
              ))}
          {"\n"}
        </pre>
        <textarea
          ref={area}
          aria-label={label}
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          onScroll={follow}
          onSelect={cursor}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="code-editor-layer absolute inset-0 h-full w-full outline-none"
        />
      </div>
    </div>
  );
}
