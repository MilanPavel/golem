<script setup lang="ts">
// The 9×6 pixel golem, as in the TUI and the web UI (docs/design/web.md, "The pixel golem").
// `cell` is the size of one pixel in px, a whole number, so the edges stay crisp.
import { computed } from "vue";
import { GOLEM_CELLS, GOLEM_HEIGHT, GOLEM_WIDTH } from "../golem.ts";

export type GolemState = "idle" | "thinking" | "waiting" | "failed" | "offline";

const LABEL: Record<GolemState, string> = {
  idle: "idle",
  thinking: "working",
  waiting: "waiting for you",
  failed: "last run failed",
  offline: "offline",
};

const props = withDefaults(defineProps<{ cell?: number; state?: GolemState; decorative?: boolean }>(), {
  cell: 4,
  state: "idle",
  decorative: false,
});

const width = computed(() => GOLEM_WIDTH * props.cell);
const height = computed(() => GOLEM_HEIGHT * props.cell);
</script>

<template>
  <svg
    class="pixel-golem"
    :data-state="state"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${GOLEM_WIDTH} ${GOLEM_HEIGHT}`"
    shape-rendering="crispEdges"
    :role="decorative ? undefined : 'img'"
    :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="decorative ? undefined : `golem · ${LABEL[state]}`"
  >
    <rect
      v-for="{ x, y, eye } in GOLEM_CELLS"
      :key="`${x}-${y}`"
      :x="x"
      :y="y"
      width="1.02"
      height="1.02"
      :class="eye ? 'eye' : 'body'"
    />
  </svg>
</template>
