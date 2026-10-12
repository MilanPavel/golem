import { Box, Text } from "ink";

import type { FrameMode } from "./chrome.ts";
import { LOGO_ROWS, LOGO_WIDTH, logoRows, type LogoRun } from "./logo.ts";
import { CLAY, LOGO_BODY, LOGO_EYE, LOGO_HIGHLIGHT, LOGO_SHADOW } from "./theme.ts";

export function Header({
  mode,
  version,
  model,
  cwd,
  columns,
}: {
  mode: FrameMode;
  version: string;
  model: string;
  cwd: string;
  columns: number;
}) {
  if (mode === "hidden") {
    return null;
  }
  if (mode === "compact") {
    const text = ["golem", model, cwd].filter((part) => part.length > 0).join("  ");
    return (
      <Text wrap="truncate-end">
        <Text color={LOGO_BODY}>█ </Text>
        {text}
      </Text>
    );
  }
  const textWidth = Math.max(1, columns - LOGO_WIDTH - 1);
  return (
    <Box width={columns} height={LOGO_ROWS} flexDirection="row">
      <Box width={LOGO_WIDTH} flexDirection="column" marginRight={1}>
        {logoRows.map((line, lineIndex) => (
          <Text key={lineIndex} wrap="truncate-end">
            {line.map((run, index) => (
              <Text key={index} color={tone(run.color)} backgroundColor={tone(run.background)}>
                {run.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" width={textWidth}>
        <Text wrap="truncate-end" bold>
          golem
          {version.length > 0 ? <Text dimColor>{` ${version}`}</Text> : null}
        </Text>
        <Text wrap="truncate-end" color={CLAY} bold>
          {model.length > 0 ? model : " "}
        </Text>
        <Text wrap="truncate-end" dimColor>
          {cwd.length > 0 ? cwd : " "}
        </Text>
      </Box>
    </Box>
  );
}

function tone(name: LogoRun["color"]): string | undefined {
  if (name === "highlight") {
    return LOGO_HIGHLIGHT;
  }
  if (name === "body") {
    return LOGO_BODY;
  }
  if (name === "shadow") {
    return LOGO_SHADOW;
  }
  if (name === "eye") {
    return LOGO_EYE;
  }
  return undefined;
}
