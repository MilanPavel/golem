<script setup lang="ts">
// The README's demo, in a terminal window. The three dots take golem's deny, wait, and allow.
import { withBase } from "vitepress";
</script>

<template>
  <figure class="golem-terminal">
    <div class="golem-terminal-bar" aria-hidden="true">
      <span class="dot deny" /><span class="dot wait" /><span class="dot allow" />
      <span class="golem-terminal-title">golem · ~/my-project</span>
    </div>
    <img :src="withBase('/demo.gif')" alt="Chatting in the golem terminal" width="960" height="678" loading="lazy" />
  </figure>
</template>
