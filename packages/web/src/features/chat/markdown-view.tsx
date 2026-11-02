import { memo, useEffect, useMemo, useRef } from "react";
import { highlightCodeBlocks } from "./highlight.ts";
import { renderMarkdown } from "./markdown.ts";

/**
 * Sanitized Markdown. This is the only file in the repo that may use dangerouslySetInnerHTML:
 * `renderMarkdown` is the only way HTML reaches it. Code blocks are coloured once the message is
 * finished, never while it streams.
 */
export const Markdown = memo(function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streaming || !ref.current) return;
    void highlightCodeBlocks(ref.current);
  }, [html, streaming]);

  return <div ref={ref} className="md" dangerouslySetInnerHTML={{ __html: html }} />;
});
