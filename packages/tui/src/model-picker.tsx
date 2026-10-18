import { Box, Text } from "ink";

import { type PickerRow } from "./model-picker.ts";
import { CLAY } from "./theme.ts";

/** The model list in place of the transcript. The first line is the key hint. */
export function ModelPickerView({
  rows,
  columns,
  height,
  hint,
}: {
  rows: readonly PickerRow[];
  columns: number;
  height: number;
  hint: string;
}) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      <Text dimColor wrap="truncate-end">
        {`Models  ${hint}`}
      </Text>
      {rows.map((row, index) => {
        if (row.kind === "header") {
          return (
            <Text key={`h${index}`} bold wrap="truncate-end">
              {row.text}
            </Text>
          );
        }
        if (row.kind === "note") {
          return (
            <Text key={`n${index}`} dimColor wrap="truncate-end">
              {`  ${row.text}`}
            </Text>
          );
        }
        const used = 4 + row.label.length + (row.detail.length > 0 ? row.detail.length + 2 : 0) + row.facts.length;
        const pad = " ".repeat(Math.max(1, columns - used));
        return (
          <Text key={row.ref} wrap="truncate-end" inverse={row.selected}>
            <Text color={CLAY}>{row.selected ? "›" : " "}</Text>
            <Text color={row.current ? "green" : undefined} dimColor={!row.current}>
              {row.current ? " ● " : "   "}
            </Text>
            <Text bold={row.current} dimColor={!row.ready}>
              {row.label}
            </Text>
            {row.detail.length > 0 ? <Text dimColor>{`  ${row.detail}`}</Text> : null}
            <Text dimColor>{`${pad}${row.facts}`}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
