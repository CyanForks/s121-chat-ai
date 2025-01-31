import { Context } from "@koishijs/client";
import Page from "./page.vue";

export default (ctx: Context) => {
  ctx.page({
    name: "Chat AI",
    path: "/chat-ai",
    fields: ["chatai"],
    component: Page,
  });
};
