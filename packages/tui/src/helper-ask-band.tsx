import { Box, Text } from "ink";

import { type ApprovalLine } from "./approval.ts";

/** A helper's question above the composer: the lines of `helperAskLines`, one `Text` each. */
export function HelperAskBand({ lines, columns, height }: { lines: readonly ApprovalLine[]; columns: number; height: number }) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {lines.slice(0, height).map((line, index) => (
        <Text key={index} bold={line.bold === true} dimColor={line.dim === true} color={line.tone === "question" ? "yellow" : undefined} wrap="truncate-end">
          {line.text}
        </Text>
      ))}
    </Box>
  );
}
