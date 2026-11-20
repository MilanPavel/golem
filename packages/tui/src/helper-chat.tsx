import { Box, Text } from "ink";

import type { StepsLine } from "./steps-view.ts";

/**
 * Steps and a helper's read-only chat, drawn full screen: the lines `layoutStepsManager` made, one `Text`
 * each. There is no composer here; the lead is the one who talks to the helper.
 */
export function StepsManagerView({ lines, columns, height }: { lines: readonly StepsLine[]; columns: number; height: number }) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate-end" bold={line.selected === true}>
          {line.spans.length === 0 ? " " : null}
          {line.spans.map((span, at) => (
            <Text
              key={at}
              bold={span.bold === true}
              italic={span.italic}
              dimColor={span.dim === true}
              color={span.color ?? (span.warn === true ? "yellow" : span.code === true ? "cyan" : undefined)}
            >
              {span.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
