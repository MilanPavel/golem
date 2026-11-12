import { Box, Text } from "ink";

import { shortStepper, type SetupFacts, type SetupLine, type SetupWindow } from "@golem/view";

import {
  compactSetup,
  labelWidth,
  lineSpans,
  rowWidth,
  setupInner,
  SETUP_WIDTH,
  shortHint,
  stepperSpans,
  type Span,
} from "./setup-frame.ts";
import { CLAY } from "./theme.ts";

function SpanText({ span }: { span: Span }) {
  switch (span.tone) {
    case "plain":
      return <Text>{span.text}</Text>;
    case "bold":
      return <Text bold>{span.text}</Text>;
    case "dim":
      return <Text dimColor>{span.text}</Text>;
    case "ok":
      return <Text color="green">{span.text}</Text>;
    case "fail":
      return <Text color="red">{span.text}</Text>;
    case "attn":
      return <Text color="yellow">{span.text}</Text>;
    case "clay":
      return <Text color={CLAY}>{span.text}</Text>;
    case "selected":
      return (
        <Text bold color={CLAY}>
          {span.text}
        </Text>
      );
  }
}

function Line({ spans }: { spans: readonly Span[] }) {
  return (
    <Text wrap="truncate-end">
      {spans.map((span, index) => (
        <SpanText key={index} span={span} />
      ))}
    </Text>
  );
}

function Hint({ text }: { text: string }) {
  const parts = text.split(" · ");
  return (
    <Text wrap="truncate-end">
      {parts.map((part, index) => {
        const space = part.indexOf(" ");
        const key = space < 0 ? part : part.slice(0, space);
        const rest = space < 0 ? "" : part.slice(space);
        return (
          <Text key={index}>
            {index > 0 ? <Text dimColor> · </Text> : null}
            <Text bold>{key}</Text>
            <Text dimColor>{rest}</Text>
          </Text>
        );
      })}
    </Text>
  );
}

/** The setup window on an empty screen: no logo, composer, or status bar behind it. */
export function SetupFrame({
  window,
  facts,
  lines,
  hint,
  version,
  columns,
  rows,
  frame,
}: {
  window: SetupWindow;
  facts?: SetupFacts;
  lines: readonly SetupLine[];
  hint: string;
  version: string;
  columns: number;
  rows: number;
  frame: number;
}) {
  const compact = compactSetup(columns, rows);
  const inner = setupInner(columns, rows);
  const labels = labelWidth(lines);
  const steps = stepperSpans(window, facts);
  const short = shortStepper(window);
  const body = lines.map((line, index) => <Line key={index} spans={lineSpans(line, inner, frame, labels, rowWidth(lines))} />);
  if (compact) {
    return (
      <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
        <Text wrap="truncate-end">
          <Text bold>golem setup</Text>
          {short === null ? null : <Text dimColor> · {short}</Text>}
        </Text>
        {body}
        {hint.length > 0 ? <Hint text={shortHint(hint)} /> : null}
      </Box>
    );
  }
  return (
    <Box width={columns} height={rows} flexDirection="column" alignItems="center" justifyContent="center" overflow="hidden">
      <Box
        flexDirection="column"
        width={Math.min(SETUP_WIDTH, columns)}
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        flexShrink={0}
      >
        <Box width={inner} justifyContent="space-between">
          <Text bold>golem setup</Text>
          <Text dimColor>{version}</Text>
        </Box>
        {steps === null ? null : (
          <>
            <Text> </Text>
            <Line spans={steps} />
          </>
        )}
        <Text> </Text>
        {body}
        {hint.length > 0 ? (
          <>
            <Text> </Text>
            <Hint text={hint} />
          </>
        ) : null}
      </Box>
    </Box>
  );
}
