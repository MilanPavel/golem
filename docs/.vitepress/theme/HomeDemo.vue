<script setup lang="ts">
// "See it work": the same task in the terminal and in the browser, recorded from the real golem
// with a scripted model (`just demo-tui`, `just demo-web`). The three dots take golem's deny,
// wait, and allow. Under prefers-reduced-motion the video does not play; its poster is the end.
import { computed, onMounted, ref, watch } from "vue";
import { withBase } from "vitepress";

const demos = [
  {
    id: "tui",
    label: "Terminal",
    title: "golem · ~/my-project",
    alt: "In the terminal, golem is asked to fix a test that fails on an empty list. It reads stats.py, shows the edit as a diff and you allow it, asks to run the tests and you allow it, and says all three tests pass.",
  },
  {
    id: "web",
    label: "Browser",
    title: "127.0.0.1 · golem web",
    alt: "In the browser, the same task: golem reads stats.py, an approval card shows the diff and you allow it, a second card asks to run the tests, and the answer says all three tests pass.",
  },
] as const;

type DemoId = (typeof demos)[number]["id"];

const current = ref<DemoId>("tui");
const video = ref<HTMLVideoElement | null>(null);
const still = ref(true);
const demo = computed(() => demos.find((d) => d.id === current.value) ?? demos[0]);

onMounted(() => {
  still.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!still.value) void video.value?.play().catch(() => undefined);
});

// A new tab starts its video from the beginning.
watch(current, () => {
  requestAnimationFrame(() => {
    if (!still.value) void video.value?.play().catch(() => undefined);
  });
});
</script>

<template>
  <div class="golem-demo">
    <div class="golem-demo-tabs" role="tablist" aria-label="Where you chat with golem">
      <button
        v-for="d in demos"
        :key="d.id"
        type="button"
        role="tab"
        :aria-selected="current === d.id"
        :class="{ active: current === d.id }"
        @click="current = d.id"
      >
        {{ d.label }}
      </button>
    </div>
    <figure class="golem-terminal" :class="`golem-demo-${current}`">
      <div class="golem-terminal-bar" aria-hidden="true">
        <span class="dot deny" /><span class="dot wait" /><span class="dot allow" />
        <span class="golem-terminal-title">{{ demo.title }}</span>
      </div>
      <video
        ref="video"
        :key="current"
        :poster="withBase(`/demo-${current}.jpg`)"
        muted
        loop
        playsinline
        preload="metadata"
        width="1600"
        height="960"
        :aria-label="demo.alt"
      >
        <source :src="withBase(`/demo-${current}.mp4`)" type="video/mp4" />
      </video>
    </figure>
  </div>
</template>
