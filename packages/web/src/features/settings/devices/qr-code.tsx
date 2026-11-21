import { encodeQr, qrSpan, qrToPath } from "@golem/view";
import { useMemo } from "react";

/**
 * The pairing link as a QR code. A scanner needs dark modules on a light ground, so the card
 * keeps the light colours of the tokens in a dark theme too (`scheme-light` makes the tokens
 * read as their light values inside it).
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const drawn = useMemo(() => {
    try {
      const code = encodeQr(text);
      return { span: qrSpan(code), path: qrToPath(code) };
    } catch {
      return null;
    }
  }, [text]);
  if (drawn === null) return <p className="text-sm text-deny">The link is too long for a code.</p>;
  return (
    <div className="scheme-light size-44 shrink-0 rounded-lg border border-line bg-surface">
      <svg viewBox={`0 0 ${drawn.span} ${drawn.span}`} role="img" aria-label={label} shapeRendering="crispEdges" className="size-full">
        <path d={drawn.path} className="fill-ink" />
      </svg>
    </div>
  );
}
