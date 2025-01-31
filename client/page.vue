<template>
  <k-layout>
    <div class="container" v-if="store.chatai.length">
      <k-card
        class="card"
        v-for="channel in store.chatai"
        :key="channel.channelId"
        :title="`${channel.guildName}/${channel.channelName}`"
      >
        <div class="msg-container">
          <template v-for="(message, index) in channel.chatHistory">
            <div
              v-if="
                channel.chatHistory.length - index === channel.chatContextSize
              "
              class="msg-context"
            >
              以下内容用户可见
            </div>
            <message-card
              class="msg-card"
              :role="message.role"
              :name="message.name"
              :content="message.content"
            ></message-card>
          </template>
        </div>
      </k-card>
    </div>
    <k-empty v-else> 暂无聊天记录 </k-empty>
  </k-layout>
</template>

<script setup lang="ts">
import { store } from "@koishijs/client";
import MessageCard from "./message-card.vue";
</script>

<style scoped>
:global(.layout-container .main-container .layout-main) {
  overflow-y: auto !important;
}

.container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-auto-rows: 70vh;
  gap: 1rem;
  padding: 1rem;
}

.msg-container {
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  gap: 1rem;
}

.msg-card {
  width: 100%;
}

.msg-context {
  text-align: center;
  font-size: 0.8rem;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 1rem;
}

:deep(.card > header) {
  margin: 0;
}
:deep(.card > .k-card-body) {
  margin: 0;
  flex: 1;
  padding: 1.5rem;
  padding-top: 0;
  overflow-y: auto;
}
</style>
