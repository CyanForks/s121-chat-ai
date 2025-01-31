<template>
  <k-card :title="title">
    <article v-html="content" class="markdown-body"></article>
  </k-card>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import type { PromptItem } from "../src/chat-ai-provider";
import markdownit from "markdown-it";
import hljs from "highlight.js";
import "./markdown.css";

const props = defineProps<PromptItem>();
const md = markdownit({
  linkify: true,
  breaks: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(str, { language: lang }).value;
      } catch (__) {}
    }
    return "";
  },
});

const title = computed(() => {
  if (!props.name) return props.role;
  return `${props.role}/${props.name}`;
});
const content = computed(() => {
  return md.render(props.content);
});
</script>
