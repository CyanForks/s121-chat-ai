import { DataService } from "@koishijs/plugin-console";
import { $, Context, Element, h, sleep } from "koishi";
import OpenAI from "openai";
import { Mutex } from "async-mutex";
import { Config } from ".";
import { AIConfig, ChatAiData } from "./type";
import { canUseAi } from "./helper/can-use-ai";
import { isCallMyself } from "./helper/is-call-myself";
import { genAsync, genStream } from "./helper/ai";

export class ChatAIProvider extends DataService<ChatAiData[]> {
  mutexAi = new Mutex();
  mutexDB = new Mutex();
  config = new Map<string, AIConfig>();
  defaultAi: string;

  constructor(ctx: Context, config: Config) {
    super(ctx, "chatai");
    this.ctx.config.refreshView = this.refresh.bind(this);
    this.defaultAi = config.defaultAi;
    for (const ai of config.aiList) {
      this.ctx.clients.set(ai.name, new OpenAI(ai));
      this.config.set(ai.name, ai);
    }

    ctx.command("chat-ai <prompt:text>").action(async ({ session }, prompt) => {
      session.content = prompt;
      if (!session.discord) {
        const res = await genAsync(ctx, session);
        await session.send(res);
        return;
      }
      const stream = genStream(ctx, session);
      let res = (await stream.next()).value;
      if (!res) return session.text("agent-not-responding");
      const [id] = await session.send(res);
      const mutex = new Mutex();
      for await (const chunk of stream) {
        res += chunk;
        if (!mutex.isLocked()) {
          mutex.runExclusive(() =>
            session.bot.editMessage(session.channelId, id, res as string)
          );
        }
      }
      await mutex.waitForUnlock();
      let isSuccess = false;
      for (let i = 1; i < 10; i++) {
        try {
          await session.bot.editMessage(session.channelId, id, res);
          isSuccess = true;
          break;
        } catch (e) {
          console.error(e);
          await sleep(500 * i);
        }
      }
      if (!isSuccess) {
        session.bot.editMessage(
          session.channelId,
          id,
          session.text("agent-not-responding")
        );
      }
    });

    ctx.command("chat-ai/show-context").action(async ({ session }) => {
      return (
        <>
          {session.text(".context-is")}
          <code-block language="json">
            {JSON.stringify(await ctx.dbhelper.getContext(session), null, 2)}
          </code-block>
        </>
      );
    });

    ctx.command("chat-ai/clear-context").action(async ({ session }) => {
      await ctx.dbhelper.clearContext(session);
      return session.text(".context-cleared");
    });

    ctx.command("chat-ai/list-agents").action(async ({ session }) => {
      const aiName = await ctx.dbhelper.getData(
        session,
        "aiName",
        this.defaultAi
      );
      const agents = ctx.config.aiList
        .map(({ name, onlyNsfw }) => {
          const tag = [
            onlyNsfw ? "(NSFW)" : "",
            aiName === name ? "(*)" : "",
          ].join(" ");
          return `- ${name} ${tag}`;
        })
        .join("\n");
      session.send(`${session.text(".agents-are")}\n${agents}`);
    });

    ctx
      .command("chat-ai/use-agent <model:text>")
      .action(async ({ session }, model) => {
        if (this.config.has(model)) {
          if (await canUseAi(session, this.config.get(model))) {
            await ctx.dbhelper.setData(session, "aiName", model);
            return session.text(".agent-set", [model]);
          }
          return session.text(".agent-not-available", [model]);
        }
        return session.text(".agent-not-found", [model]);
      });

    ctx.command("chat-ai/balance").action(async ({ session }) => {
      const p = ctx.config.aiList.map<Promise<Element>>(
        async ({ name, balanceUrl, balanceToken }) => {
          if (!balanceUrl || !balanceToken) {
            return <p>{session.text(".balance-not-configured", [name])}</p>;
          }
          const balance = await ctx.http.get(balanceUrl, {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${balanceToken}`,
            },
          });
          return (
            <p>
              {session.text(".balance-is", [name])}
              <code-block language="json">
                {JSON.stringify(balance, null, 2)}
              </code-block>
            </p>
          );
        }
      );
      return (await Promise.all(p)).join("\n");
    });

    ctx.on("message", async (session) => {
      if (!(await isCallMyself(ctx, session))) return;
      if (!session.discord) return session.send(await genAsync(ctx, session));
      const [id] = await session.send(
        <>
          <quote
            id={session.messageId}
            avatar={session.author.avatar}
            name={session.username}
          />
          {session.text("loading")}
        </>
      );
      session.discord.triggerTypingIndicator(session.channelId);
      session.content = h.transform(session.content, {
        at: ({ id, name }) => {
          if (id === session.selfId) return "";
          return `@${name ?? id}`;
        },
      });
      const stream = genStream(ctx, session);
      let res = "";
      const mutex = new Mutex();
      for await (const chunk of stream) {
        res += chunk;
        if (!mutex.isLocked()) {
          mutex.runExclusive(() =>
            session.bot.editMessage(session.channelId, id, res)
          );
        }
      }
      await mutex.waitForUnlock();
      let isSuccess = false;
      for (let i = 1; i < 10; i++) {
        try {
          await session.bot.editMessage(session.channelId, id, res);
          isSuccess = true;
          break;
        } catch (e) {
          console.error(e);
          await sleep(500 * i);
        }
      }
      if (!isSuccess) {
        session.bot.editMessage(
          session.channelId,
          id,
          session.text("agent-not-responding")
        );
      }
    });
  }

  get() {
    return this.ctx.database.get("chatAiData", (row) =>
      $.gt($.length(row.chatHistory), 0)
    );
  }
}
