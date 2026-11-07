import "./code-editor.css";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../ui/cn.ts";

type Token = { content: string; color?: string | undefined; fontStyle?: number | undefined };

const ITALIC = 1;
const BOLD = 2;

/** The text as coloured lines, once Shiki has loaded. Until then, and for a grammar that fails, there are none. */
function useTokens(text: string): readonly (readonly Token[])[] | null {
  const [tokens, setTokens] = useState<{ text: string; lines: readonly (readonly Token[])[] } | null>(null);
  useEffect(() => {
    let live = true;
    void import("../../chat/highlight-engine.ts")
      .then(({ tokenize }) => tokenize(text, "toml"))
      .then(
        (lines) => {
          if (live) setTokens({ text, lines });
        },
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [text]);
  // Tokens of an older text would be drawn out of place, so they show only for the text they came from.
  return tokens !== null && tokens.text === text ? tokens.lines : null;
}

/**
 * A text box for TOML: line numbers, colours, and a mark on the lines with a problem. The colours
 * are a copy of the text drawn under a transparent textarea, which keeps the browser's own editing,
 * selection, undo, and screen-reader support. Lines do not wrap, so a line is a line in both.
 */
export function CodeEditor({
  value,
  onChange,
  marked,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Line numbers (from 1) with a problem. */
  marked: ReadonlySet<number>;
  label: string;
}) {
  const tokens = useTokens(value);
  const under = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const count = value.split("\n").length;

  function follow(event: React.UIEvent<HTMLTextAreaElement>): void {
    const { scrollTop, scrollLeft } = event.currentTarget;
    if (under.current !== null) {
      under.current.scrollTop = scrollTop;
      under.current.scrollLeft = scrollLeft;
    }
    if (gutter.current !== null) gutter.current.scrollTop = scrollTop;
  }

  return (
    <div className="code-editor flex h-96 overflow-hidden rounded-md border border-line-strong bg-surface focus-within:border-clay">
      <div
        ref={gutter}
        aria-hidden="true"
        className="code-editor-layer overflow-hidden border-r border-line text-right text-faint select-none"
      >
        {Array.from({ length: count }, (_, at) => (
          <div key={at} className={cn(marked.has(at + 1) && "font-semibold text-deny")}>
            {marked.has(at + 1) ? "✘" : ""}
            {at + 1}
          </div>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
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
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={follow}
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
