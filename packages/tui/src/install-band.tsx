import { Box, Text } from "ink";

import { type InstallState, installLines } from "./ollama-install.ts";
import { CLAY } from "./theme.ts";

/** `brew install ollama` above the composer: what it prints, then how it ended. */
export function InstallBand({ state, columns, height }: { state: InstallState; columns: number; height: number }) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      {installLines(state, columns, height).map((line, index) => (
        <Text
          key={index}
          bold={line.tone === "title"}
          color={line.tone === "title" ? CLAY : line.tone === "ok" ? "green" : line.tone === "error" ? "red" : undefined}
          dimColor={line.tone === "output" || line.tone === "hint"}
          wrap="truncate-end"
        >
          {line.text}
        </Text>
      ))}
    </Box>
  );
}
