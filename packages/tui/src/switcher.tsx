import { Box, Text } from "ink";

import { type SwitcherRow } from "./switcher.ts";
import { CLAY } from "./theme.ts";

/** The session list in place of the transcript. The first line is the key hint. */
export function SwitcherView({
  rows,
  columns,
  height,
  hint,
  empty,
}: {
  rows: readonly SwitcherRow[];
  columns: number;
  height: number;
  hint: string;
  empty: string;
}) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      <Text dimColor wrap="truncate-end">
        {`Sessions  ${hint}`}
      </Text>
      {rows.length === 0 ? <Text dimColor>{empty}</Text> : null}
      {rows.map((row) => {
        const pad = " ".repeat(Math.max(1, columns - row.title.length - row.age.length - 5));
        return (
          <Text key={row.sessionId} wrap="truncate-end" inverse={row.selected}>
            <Text color={CLAY}>{row.selected ? "›" : " "}</Text>
            <Text color={row.running ? "green" : undefined} dimColor={!row.running}>
              {` ${row.running ? "●" : "○"} `}
            </Text>
            <Text bold={row.current}>{row.title}</Text>
            <Text dimColor>{`${pad}${row.age}`}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
