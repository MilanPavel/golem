import { Box, Text } from "ink";

import type { MemoryManagerLine } from "./memory-manager.ts";

const TONES = { ok: "green", bad: "red", wait: "yellow", off: "gray" } as const;

/** `/memory` drawn full screen: the lines `layoutMemoryManager` made, one `Text` each. */
export function MemoryManagerView({
  lines,
  columns,
  height,
}: {
  lines: readonly MemoryManagerLine[];
  columns: number;
  height: number;
}) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate-end" bold={line.bold === true || line.selected === true} dimColor={line.dim === true}>
          {line.prefix ?? ""}
          {line.mark ? <Text color={TONES[line.mark.tone]}>{`${line.mark.text} `}</Text> : null}
          {line.text}
        </Text>
      ))}
    </Box>
  );
}
