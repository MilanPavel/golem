import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/button.tsx";
import { Card } from "../../ui/card.tsx";
import { CopyIcon } from "../../ui/icons.tsx";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import type { ScreenSpec } from "./connection-screen.ts";

const COPIED_MS = 2000;

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <div className="flex max-w-full items-center gap-3 rounded-md border border-line-strong bg-code-bg py-2 pr-2 pl-3.5 font-mono text-sm">
      <code className="overflow-x-auto whitespace-nowrap">{command}</code>
      <Button size="sm" aria-label={copied ? "Copied" : "Copy command"} onClick={() => void copy()}>
        <CopyIcon />
        {copied ? "Copied" : "Copy"}
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}

export type ConnectionScreenProps = {
  spec: ScreenSpec;
  /** The heading level. A page has one h1; the gallery shows several screens under its own headings. */
  headingLevel?: "h1" | "h2" | "h3" | "h4";
};

/** The full-screen state of docs/design/web.md: golem, a tag, a heading, a sentence, a command. */
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
      </Card>
    </div>
  );
}
