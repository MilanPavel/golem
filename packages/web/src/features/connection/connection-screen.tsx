import { Card } from "../../ui/card.tsx";
import { CopyButton } from "../../ui/copy-command.tsx";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import type { ScreenSpec } from "./connection-screen.ts";

function CommandRow({ command }: { command: string }) {
  return (
    <div className="flex max-w-full items-center gap-2 rounded-md border border-line-strong bg-code-bg py-1.5 pr-1.5 pl-3.5 font-mono text-sm">
      <code className="overflow-x-auto whitespace-nowrap">{command}</code>
      <CopyButton text={command} label="command" />
    </div>
  );
}

export type ConnectionScreenProps = {
  spec: ScreenSpec;
  /** The heading level. A page has one h1; the gallery shows several screens under its own headings. */
  headingLevel?: "h1" | "h2" | "h3" | "h4";
};

/** The full-screen state of docs/design/index.md: golem, a tag, a heading, a sentence, a command. */
export function ConnectionScreen({ spec, headingLevel: Heading = "h1" }: ConnectionScreenProps) {
  return (
    <div data-screen={spec.kind} className="grid w-full place-items-center p-5">
      <Card className="flex w-full max-w-xl flex-col items-center gap-5 p-7 text-center sm:px-6">
        <PixelGolem state={spec.golem} size="lg" />
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-4">
          <span className="rounded-full bg-sunken px-2 py-1.5 font-mono text-xs leading-none text-muted">
            {spec.tag}
          </span>
          <Heading className="font-prose text-2xl font-normal tracking-tight text-balance">{spec.heading}</Heading>
        </div>
        <p className="max-w-lg text-pretty text-muted">{spec.sentence}</p>
        {spec.command === null ? null : <CommandRow command={spec.command} />}
        {spec.extras.map((extra) => (
          <div key={extra.command} className="flex max-w-full flex-col items-center gap-3">
            {extra.sentence === null ? null : <p className="max-w-lg text-pretty text-muted">{extra.sentence}</p>}
            <CommandRow command={extra.command} />
          </div>
        ))}
      </Card>
    </div>
  );
}
