import { Box, Text } from "ink";

import type { PendingConsent } from "@golem/view";
import { consentLines, type ConsentShow } from "./consent.ts";

/** The paid step-up question above the composer, while the run waits for the answer. */
export function ConsentBand({
  consent,
  columns,
  height,
  pager = null,
  show,
}: {
  consent: PendingConsent;
  columns: number;
  height: number;
  /** `1 of 2 · tab next` when several questions wait. */
  pager?: string | null;
  /** Whether the brief and the diff of a helper's question are open. */
  show?: ConsentShow;
}) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {consentLines(consent, columns, pager, show)
        .slice(0, height)
        .map((line, index) => (
          <Text
            key={index}
            bold={line.bold === true}
            dimColor={line.dim === true}
            color={line.tone === "question" ? "yellow" : undefined}
            wrap="truncate-end"
          >
            {line.text}
          </Text>
        ))}
    </Box>
  );
}
