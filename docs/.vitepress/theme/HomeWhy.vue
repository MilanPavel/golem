<script setup lang="ts">
// "Why golem": the README's four cards, each drawn on parchment.
import { withBase } from "vitepress";

const cards = [
  {
    image: "/why-local.svg",
    alt: "The golem works inside your Mac; a hosted model in the cloud is called only when needed, and each answer shows its cost",
    title: "Local models first",
    text: "Most agent tools assume a huge hosted model. Golem gets real work out of the model on your laptop, and calls a hosted one only when the task needs it. You always see what each answer costs.",
  },
  {
    image: "/why-lab.svg",
    alt: "A three-panel story: task 1 takes nine steps, the golem writes down a skill, and task 2 takes three",
    title: "Learns as it goes",
    text: "Memory and skills the agent writes for itself, so each task makes the next one easier. Golem is also a lab for context compaction, routing between models, and stepping up when a small model struggles.",
  },
  {
    image: "/why-built.svg",
    alt: "A blueprint of the golem in a circle and a square, with its parts labelled: memory, protocol, crash recovery, permissions, sandbox, evals",
    title: "Built from scratch",
    text: "Golem builds the hard parts itself, to learn what a reliable agent really needs: it survives a crash, asks before risky steps, runs commands in a safe shell, and tests its own answers.",
  },
  {
    image: "/why-tools.svg",
    alt: "The golem asks before it acts: a prompt reads 'May I run pytest -q?' with allow and deny buttons, above its tools: files, shell, git, web",
    title: "Asks before it acts",
    text: "Files, the shell, git, and the web are built in. Every tool call passes one permission layer, so golem asks before it does anything that matters.",
  },
];
</script>

<template>
  <div class="golem-why">
    <article v-for="card in cards" :key="card.title" class="golem-why-card">
      <img :src="withBase(card.image)" :alt="card.alt" width="440" height="250" loading="lazy" />
      <h3>{{ card.title }}</h3>
      <p>{{ card.text }}</p>
    </article>
  </div>
</template>
