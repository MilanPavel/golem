import { FOOTER_PART_LABELS, FOOTER_PARTS, STRONGER_ACTION, turnFooter, turnFooterLine, type Detail, type FooterChoice, type FooterPart } from "@golem/view";
import { cn } from "../../ui/cn.ts";

/** What the sample turn knows for its footer: the last answer's time, its steps and its totals. */
export function sampleFooter(messages: Parameters<typeof turnFooter>[0]): NonNullable<ReturnType<typeof turnFooter>> {
  const source = turnFooter(messages);
  if (source === null) throw new Error("the sample turn is finished");
  return source;
}

type Source = ReturnType<typeof sampleFooter>;

/** The real line under an answer for this choice, as a chat would show it. The sample is on a local model, so "↑ stronger model" is offered. */
export function FooterSample({ source, choice, detail }: { source: Source; choice: FooterChoice; detail: Detail }) {
  const parts = turnFooterLine(source, choice, { detail });
  return (
    <p data-footer-line className="text-meta text-faint">
      {parts.join(" · ")}
      {parts.length > 0 ? " · " : ""}
      <span className="text-clay-ink">{STRONGER_ACTION}</span>
    </p>
  );
}

/** What one part says for the sample turn, with nothing left out. */
function partValue(source: Source, part: FooterPart, detail: Detail): string {
  return turnFooterLine(source, { off: FOOTER_PARTS.filter((other) => other !== part), leaveOutEmpty: false }, { detail }).join(" ");
}

/**
 * One chip for each part of the line. A part that is on shows its sample value, a part that is off is dashed and
 * shows its name, and a part that is on but left out because it says nothing is struck through. A click turns it on or off.
 */
export function FooterChips({ source, choice, detail, onToggle }: { source: Source; choice: FooterChoice; detail: Detail; onToggle: (part: FooterPart) => void }) {
  return (
    <div role="group" aria-label="Parts of the line under each answer" className="flex flex-wrap items-center gap-1.5">
      {FOOTER_PARTS.map((part) => {
        const label = FOOTER_PART_LABELS[part];
        const off = choice.off.includes(part);
        const leftOut = !off && turnFooterLine(source, { off: FOOTER_PARTS.filter((other) => other !== part), leaveOutEmpty: choice.leaveOutEmpty }, { detail }).length === 0;
        return (
          <button
            key={part}
            type="button"
            aria-pressed={!off}
            aria-label={label}
            title={leftOut ? `${label}: left out here, it says nothing` : label}
            data-part={part}
            data-left-out={leftOut ? "true" : undefined}
            onClick={() => {
              onToggle(part);
            }}
            className={cn(
              "cursor-pointer rounded-md border px-2 py-0.5 text-xs outline-offset-2 outline-clay focus-visible:outline-2",
              off ? "border-dashed border-line-strong text-faint opacity-70 hover:opacity-100" : "border-line bg-surface text-ink-soft hover:border-line-strong",
              leftOut && "text-faint line-through",
            )}
          >
            {off ? label : partValue(source, part, detail)}
          </button>
        );
      })}
    </div>
  );
}
