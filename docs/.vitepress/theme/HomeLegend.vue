<script setup lang="ts">
// The legend line under the hero, in the README's lettering: slip's version, or kiln's.
import { withBase } from "vitepress";

const alt = "The name comes from the Prague legend. A clay servant, brought to life to work on its maker's behalf.";
</script>

<template>
  <figure class="golem-legend">
    <img class="only-slip" :src="withBase('/legend-light.svg')" :alt="alt" width="672" height="168" />
    <img class="only-kiln" :src="withBase('/legend-dark.svg')" :alt="alt" width="672" height="168" />
  </figure>
</template>
