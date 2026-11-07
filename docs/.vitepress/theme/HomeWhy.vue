<script setup lang="ts">
// "Why golem": the home page's five cards, each drawn on parchment (scripts/figures/parchment.py
// draws the new ones). The first is wide: picture and text side by side.
import { withBase } from "vitepress";

const cards = [
  {
    image: "/why-built.svg",
    alt: "A blueprint of the golem in a circle and a square, with its parts labelled: memory, protocol, crash recovery, permissions, sandbox, evals",
    title: "Learn how an agent is built",
    text: "Each part of the agent is written from scratch and documented: the agent loop, the protocol, sessions that survive a crash, permissions, sandboxes, skills, and evals. How golem works gives each part a chapter: first the general idea, then how golem does it.",
    wide: true,
  },
  {
    image: "/why-local.svg",
    alt: "The golem works inside your Mac; a hosted model in the cloud is called only when needed, and each answer shows its cost",
    title: "Local first, and private",
    text: "Golem gets real work out of the model on your laptop, for free, and nothing leaves the machine. A hosted model is a choice you make, never a requirement.",
  },
  {
    image: "/why-route.svg",
    alt: "Three requests reach the router golem: two go to a local model for $0.00, one to a hosted model for $0.02, under a daily budget",
    title: "Smart routing, cost you see",
    text: "The cheapest model that can do the job does it. Golem steps up to a bigger one only when a small one struggles, shows what every answer cost, and keeps to your budget.",
  },
  {
    image: "/why-away.svg",
    alt: "At night the golem and three helper golems work through a workflow; in the morning the phone asks: 3 PRs green, post them?",
    title: "Works while you're away",
    text: "Workflows run on a schedule, survive a restart, and act exactly once. Sub-agents split a big task into small ones. Golem asks you only when it matters, on whatever screen you have.",
  },
  {
    image: "/why-app.svg",
    alt: "Your app calls the agent over an API; the agent runs in a container with no model inside, and the model sits beyond a wall at any URL",
    title: "The agent behind your app",
    text: "The agent you shaped in your terminal deploys as the agent behind an application. It holds the rules and the tools; the models stay outside, as endpoints you can swap.",
  },
];
</script>

<template>
  <div class="golem-why">
    <article
      v-for="card in cards"
      :key="card.title"
      class="golem-why-card"
      :class="{ 'golem-why-card--wide': card.wide }"
    >
      <img :src="withBase(card.image)" :alt="card.alt" width="440" height="250" loading="lazy" />
      <div>
        <h3>{{ card.title }}</h3>
        <p>{{ card.text }}</p>
      </div>
    </article>
  </div>
</template>
