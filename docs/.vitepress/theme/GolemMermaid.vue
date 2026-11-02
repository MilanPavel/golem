<script setup lang="ts">
// A Mermaid diagram drawn in golem's palette, for slip and for kiln. It replaces
// vitepress-plugin-mermaid, which always draws dark mode in Mermaid's own dark theme.
import { useData } from "vitepress";
import { onMounted, ref, useId, watch } from "vue";
import palette from "virtual:golem-tokens";
import { mermaidTheme } from "./mermaid-theme";

const props = defineProps<{ code: string }>();
const { isDark } = useData();
const svg = ref("");
const failed = ref("");
const id = `golem-mermaid-${useId()}`;
const source = decodeURIComponent(props.code);

async function draw(): Promise<void> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", ...mermaidTheme(palette, isDark.value) });
  try {
    svg.value = (await mermaid.render(`${id}-${isDark.value ? "kiln" : "slip"}`, source)).svg;
    failed.value = "";
  } catch (error) {
    failed.value = String(error);
  }
}

onMounted(draw);
watch(isDark, draw);
</script>

<template>
  <figure class="golem-mermaid">
    <div v-if="svg" v-html="svg" />
    <pre v-else-if="failed" class="golem-mermaid-failed">{{ failed }}</pre>
    <pre v-else class="golem-mermaid-source">{{ source }}</pre>
  </figure>
</template>
