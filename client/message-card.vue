<template>
  <k-card :title="title">
    <article v-html="content" class="markdown-body"></article>
  </k-card>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import type { PromptItem } from "../src/chat-ai-provider";
import { fromAsyncCodeToHtml } from "@shikijs/markdown-it/async";
import MarkdownItAsync from "markdown-it-async";
import { codeToHtml } from "shiki";
import "./markdown.css";
import { asyncComputed } from "@vueuse/core";

const props = defineProps<PromptItem>();

const md = MarkdownItAsync({
  linkify: true,
  breaks: true,
}).use(
  fromAsyncCodeToHtml(codeToHtml, {
    themes: {
      light: "vitesse-light",
      dark: "vitesse-dark",
    },
  })
);

const title = computed(() => {
  if (!props.name) return props.role;
  return `${props.role}/${props.name}`;
});
const content = asyncComputed(() => md.renderAsync(props.content));
</script>
