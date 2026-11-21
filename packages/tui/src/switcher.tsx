import { Box, Text } from "ink";

import { ROUTINE_MARK } from "@golem/view";

import { FORK_TAG, type SwitcherRow } from "./switcher.ts";
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
      {rows.flatMap((row) => {
        const mark = row.routine ? `${ROUTINE_MARK} ` : "";
        const squares = (row.helpers.length > 0 ? row.helpers.length + 1 : 0) + (row.fork ? FORK_TAG.length + 1 : 0);
        const pad = " ".repeat(Math.max(1, columns - mark.length - row.title.length - squares - row.age.length - 5));
        const line = (
          <Text key={row.sessionId} wrap="truncate-end" inverse={row.selected}>
            <Text color={CLAY}>{row.selected ? "›" : " "}</Text>
            <Text
              color={row.waiting ? "yellow" : row.running ? "green" : undefined}
              dimColor={(!row.running && !row.waiting) || row.queued}
            >
              {` ${row.waiting ? "?" : row.queued ? "◌" : row.running ? "●" : "○"} `}
            </Text>
            {row.routine ? <Text dimColor>{mark}</Text> : null}
            <Text bold={row.current}>{row.title}</Text>
            {row.fork ? <Text dimColor>{` ${FORK_TAG}`}</Text> : null}
            {row.helpers.length > 0 ? (
              <Text>
                {" "}
                {row.helpers.map((square, index) => (
                  <Text key={index} color={square === "asking" ? "yellow" : square === "working" ? "green" : undefined} dimColor={square === "queued"}>
                    {square === "queued" ? "□" : "■"}
                  </Text>
                ))}
              </Text>
            ) : null}
            <Text dimColor>{`${pad}${row.age}`}</Text>
          </Text>
        );
        // The open lead's helpers, one line each: the mark, the agent and brief, the newest step while it works.
        const under = row.lines.map((item) => (
          <Text key={`${row.sessionId}:${item.sessionId}`} wrap="truncate-end">
            <Text color={item.square === "asking" ? "yellow" : item.square === "working" ? "green" : undefined} dimColor={item.square === "queued" || item.square === "done"}>
              {`    ${item.square === "queued" ? "□" : item.square === "done" ? "✓" : "■"} `}
            </Text>
            <Text dimColor={item.square === "done"}>{item.text}</Text>
            {item.step === null ? null : <Text dimColor>{`  ${item.step}`}</Text>}
          </Text>
        ));
        return [line, ...under];
      })}
    </Box>
  );
}
