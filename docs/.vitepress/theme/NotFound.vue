<script setup lang="ts">
// The 404 page, in the style of the web UI's full-screen states: a grey golem, a short tag,
// a Literata heading, one sentence, and the way back.
import { computed } from "vue";
import { useData, useRoute, withBase } from "vitepress";
import PixelGolem from "./PixelGolem.vue";

const route = useRoute();
const { site } = useData();
// The path as the docs know it, without the site's /golem/ base.
const path = computed(() => `/${route.path.slice(site.value.base.length)}`);
</script>

<template>
  <main class="golem-state">
    <PixelGolem :cell="12" state="offline" />
    <p class="golem-state-tag">404 · {{ path }}</p>
    <h1 class="golem-state-heading">This page is not in the docs</h1>
    <p class="golem-state-text">It may have moved when the docs were reorganised. Search, or start from the top.</p>
    <a class="golem-state-link" :href="withBase('/')">Back to the docs</a>
  </main>
</template>
