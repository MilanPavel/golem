import { Box, Text } from "ink";

import { checksBandText } from "./checks-band.ts";

/** The question above the composer: may golem run the project's checks after its edits? */
export function ChecksBand({
  offered,
  columns,
  height,
}: {
  offered: readonly { name: string; command: string }[];
  columns: number;
  height: number;
}) {
  return (
    <Box flexDirection="column" width={columns} height={height} flexShrink={0} overflow="hidden">
      <Text color="yellow" wrap="truncate-end">
        {checksBandText(offered, columns)}
      </Text>
    </Box>
  );
}
