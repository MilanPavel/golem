import { Box, Text } from "ink";

import { CLAY } from "./theme.ts";
import type { WelcomeRow } from "./welcome.ts";

const LABEL_WIDTH = 18;

/** The first-start card in place of the transcript. */
export function WelcomeView({ rows, columns, height }: { rows: readonly WelcomeRow[]; columns: number; height: number }) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden" paddingLeft={1}>
      {rows.map((row, index) => {
        switch (row.kind) {
          case "title":
            return (
              <Text key={index} bold wrap="truncate-end">
                {row.text}
              </Text>
            );
          case "blank":
            return <Text key={index}> </Text>;
          case "hint":
            return (
              <Text key={index} dimColor wrap="truncate-end">
                {row.text}
              </Text>
            );
          case "option":
            return (
              <Text key={index} wrap="truncate-end">
                <Text color={CLAY}>{row.selected ? "› " : "  "}</Text>
                <Text bold={row.selected}>{row.label.padEnd(LABEL_WIDTH)}</Text>
                <Text dimColor>{row.detail}</Text>
              </Text>
            );
        }
      })}
    </Box>
  );
}
