<script setup lang="ts">
// "See it work": three stories in the browser and one in the terminal, recorded from the real
// golem with a scripted model (`just demo-web`, `just demo-tui`). The three dots take golem's deny,
// wait, and allow. Under prefers-reduced-motion the video does not play; its poster is the end.
import { computed, onMounted, ref, watch } from "vue";
import { withBase } from "vitepress";

const demos = [
  {
    id: "search",
    label: "Sources",
    title: "127.0.0.1 · golem",
    alt: "In the browser, golem is asked about infinity and good sources to study. It searches the web and reads three pages, then answers with a source chip after each claim. A chip's hover card shows the page, and the Sources list shows the three pages it cited out of the four it found.",
  },
  {
    id: "code",
    label: "Coding",
    title: "127.0.0.1 · golem · ~/rust-hello",
    alt: "In the browser, golem is asked to make a hello world app in Rust with a test and run it. An approval card shows each file as a diff and you allow it, then the command that tests and runs it, while the Changes panel fills with the two new files.",
  },
  {
    id: "inbox",
    label: "Away",
    title: "127.0.0.1 · golem",
    alt: "In the browser, a PDF lands in a watched folder and a routine starts by itself. It stops to ask to write a file, the Inbox in the sidebar shows 1, you allow it there, and Runs shows it finished next to a scheduled routine.",
  },
  {
    id: "tui",
    label: "Terminal",
    title: "golem tui · ~/rust-hello",
    alt: "In the terminal, golem writes a Rust hello world app with a test. You allow each file as a diff and then the test run. A routine then asks for approval in another session, the banner and the status line say so, and /runs lists what needs you and what finished.",
  },
] as const;

type DemoId = (typeof demos)[number]["id"];

const current = ref<DemoId>("search");
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
    <div class="golem-demo-tabs" role="tablist" aria-label="What golem does">
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
