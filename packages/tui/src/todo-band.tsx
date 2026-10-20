import { Box, Text } from "ink";

import { CLAY } from "./theme.ts";
import { type TodoItem, todoLines } from "./todos.ts";

/** The agent's plan above the composer. The step in progress stands out, finished ones fade. */
export function TodoBand({ todos, columns, height }: { todos: readonly TodoItem[]; columns: number; height: number }) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {todoLines(todos, columns, height).map((line, index) => (
        <Text
          key={index}
          bold={line.status === "in_progress"}
          color={line.status === "in_progress" ? CLAY : undefined}
          dimColor={line.status === "done" || line.status === "summary"}
          wrap="truncate-end"
        >
          {line.text}
        </Text>
      ))}
    </Box>
  );
}
