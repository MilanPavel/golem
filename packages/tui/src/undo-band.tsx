import { Box, Text } from "ink";

import { type UndoBand as UndoState, undoLines } from "./undo.ts";

/** The `/undo` question above the composer, in the look of the approval band. */
export function UndoBand({ band, columns, height }: { band: UndoState; columns: number; height: number }) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {undoLines(band, columns, height).map((line, index) => (
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
