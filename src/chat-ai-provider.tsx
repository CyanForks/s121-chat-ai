import { DataService } from "@koishijs/plugin-console";
import { $, Context, Element, h, Session, sleep } from "koishi";
import OpenAI from "openai";
import { Mutex } from "async-mutex";
import { Stream } from "openai/streaming.mjs";
import {} from "@koishijs/plugin-adapter-discord";
import { Config } from ".";

export interface PromptItem {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
}

export interface AIConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  canWakeUpByName: boolean;
  onlyNsfw: boolean;
  maxContextSize?: number;
  fitContextSize?: number;
  systemPrompt: PromptItem[];
  isMock: boolean;
  maxPromptLength?: number;
  frequencyPenalty: number;
  maxTokens: number;
  presencePenalty: number;
  temperature: number;
  balanceUrl?: string;
  balanceToken?: string;
  topP: number;
}

declare module "koishi" {
  interface Tables {
    chatAiData: ChatAiData;
  }
}
export interface ChatAiData {
  channelId: string;
  channelName: string;
  guildId: string;
  guildName: string;
  chatHistory: PromptItem[];
  chatContextSize: number;
  aiName: string;
}

declare module "@koishijs/plugin-console" {
  namespace Console {
    interface Services {
      chatai: ChatAIProvider;
    }
  }
}

export class ChatAIProvider extends DataService<ChatAiData[]> {
  client = new Map<string, OpenAI>();
  mutexAi = new Mutex();
  mutexDB = new Mutex();
  config = new Map<string, AIConfig>();
  defaultAi: string;
  #chatHistory = new Map<string, PromptItem[]>();
  #chatContextSize = new Map<string, number>();
  #aiName = new Map<string, string>();

  constructor(ctx: Context, config: Config) {
    super(ctx, "chatai");
    this.defaultAi = config.defaultAi;
    for (const ai of config.aiList) {
      this.client.set(ai.name, new OpenAI(ai));
      this.config.set(ai.name, ai);
    }
    ctx.command("chat-ai <prompt:text>").action(async ({ session }, prompt) => {
      session.content = prompt;
      if (!session.discord) {
        const res = await this.genAsync(session);
        await session.send(res);
        return;
      }
      const stream = this.genStream(session);
      let res = (await stream.next()).value;
      if (!res) return;
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
      for (let i = 1; i < 10; i++) {
        try {
          await session.bot.editMessage(session.channelId, id, res);
          break;
        } catch (e) {
          console.error(e);
          await sleep(500 * i);
        }
      }
    });

    ctx.command("chat-ai/show-context").action(async ({ session }) => {
      return (
        <>
          {session.text(".context-is")}
          <code-block language="json">
            {JSON.stringify(await this.getContext(session), null, 2)}
          </code-block>
        </>
      );
    });

    ctx.command("chat-ai/clear-context").action(async ({ session }) => {
      await this.clearContext(session);
      return session.text(".context-cleared");
    });

    ctx.command("chat-ai/list-agents").action(async ({ session }) => {
      const agents = [...this.config.entries()]
        .map(([k, v]) => {
          if (v.onlyNsfw) return `- ${k} (NSFW)`;
          return `- ${k}`;
        })
        .join("\n");
      session.send(`${session.text(".agents-are")}\n${agents}`);
    });

    ctx
      .command("chat-ai/use-agent <model:text>")
      .action(async ({ session }, model) => {
        if (this.config.has(model)) {
          try {
            await this.setAiName(session, model);
            return session.text(".agent-set", [model]);
          } catch (e) {
            return e;
          }
        } else {
          return session.text(".agent-not-found", [model]);
        }
      });

    ctx.command("chat-ai/balance").action(async ({ session }) => {
      const p = [...this.config.entries()].map<Promise<Element>>(
        async ([name, config]) => {
          if (!config.balanceUrl || !config.balanceToken) {
            return <p>{session.text(".balance-not-configured", [name])}</p>;
          }
          const balance = await ctx.http.get(config.balanceUrl, {
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${config.balanceToken}`,
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
      if (!(await this.isCallMyself(session))) return;
      if (!session.discord) {
        const res = await this.genAsync(session);
        return await session.send(res);
      }
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
      const stream = this.genStream(session);
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
      for (let i = 1; i < 10; i++) {
        try {
          await session.bot.editMessage(session.channelId, id, res);
          break;
        } catch (e) {
          console.error(e);
          await sleep(500 * i);
        }
      }
    });
  }

  async isCallMyself(session: Session) {
    if (session.userId === session.selfId) return false;
    if (!session.guildId) return true;
    const ele = h.select(session.elements, "at");
    const isAt = ele.some((e) => e.attrs.id === session.selfId);
    if (isAt) return true;
    const res = [...this.config.entries()].filter(
      ([name, config]) =>
        config.canWakeUpByName && session.content.includes(name)
    );
    if (res.length === 0) return false;
    const aiName = await this.getAiName(session);
    const needChange = res.every(([name]) => name !== aiName);
    try {
      if (needChange) await this.setAiName(session, res[0][0]);
      return true;
    } catch (e) {
      console.error(e);
    }
    return false;
  }

  async genAsync(session: Session) {
    const stream = this.genStream(session);
    let res = "";
    for await (const chunk of stream) res += chunk;
    return res;
  }

  get() {
    return this.ctx.database.get("chatAiData", (row) =>
      $.gt($.length(row.chatHistory), 0)
    );
  }

  async getChatHistory(session: Session) {
    const release = await this.mutexDB.acquire();
    try {
      if (this.#chatHistory.has(session.channelId))
        return this.#chatHistory.get(session.channelId);
      let [data] = await this.ctx.database.get(
        "chatAiData",
        session.channelId,
        ["chatHistory"]
      );
      if (!data) {
        const [channelName, guildName] = await Promise.all([
          this.getChannelName(session),
          this.getGuildName(session),
        ]);
        data = await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName,
          guildId: session.guildId ?? "",
          guildName,
          chatContextSize: 0,
          chatHistory: [],
          aiName: this.defaultAi,
        });
      }
      return data.chatHistory;
    } finally {
      release();
    }
  }

  async setChatHistory(session: Session, chatHistory: PromptItem[]) {
    const release = await this.mutexDB.acquire();
    try {
      this.#chatHistory.set(session.channelId, chatHistory);
      let [data] = await this.ctx.database.get(
        "chatAiData",
        session.channelId,
        ["chatHistory"]
      );
      if (!data) {
        const [channelName, guildName] = await Promise.all([
          this.getChannelName(session),
          this.getGuildName(session),
        ]);
        data = await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName,
          guildId: session.guildId ?? "",
          guildName,
          chatContextSize: 0,
          chatHistory,
          aiName: this.defaultAi,
        });
        return data.chatHistory;
      }
      await this.ctx.database.set("chatAiData", session.channelId, {
        chatHistory,
      });
      this.refresh();
      return chatHistory;
    } finally {
      release();
    }
  }

  async getChannelName(session: Session) {
    if (session.event.channel.name) return session.event.channel.name;
    if (!session.guildId) {
      if (session.event.user.name) return session.event.user.name;
      const channel = await session.bot.getChannel(session.channelId);
      if (channel?.name) return channel.name;
      const user = await session.bot?.getUser(session.event.user.id);
      return user?.name ?? session.channelId;
    }
    const channel = await session.bot.getChannel(session.channelId);
    return channel?.name ?? session.channelId;
  }

  async getGuildName(session: Session) {
    if (session.guildId) {
      const guild = await session.bot.getGuild(session.guildId);
      return guild.name ?? session.guildId;
    }
    return "私聊";
  }

  async pushChatHistory(session: Session, ...chatHistory: PromptItem[]) {
    const old = await this.getChatHistory(session);
    return this.setChatHistory(session, old.concat(chatHistory));
  }

  async getChatCtxSize(session: Session) {
    const release = await this.mutexDB.acquire();
    try {
      if (this.#chatContextSize.has(session.channelId))
        return this.#chatContextSize.get(session.channelId);
      let [data] = await this.ctx.database.get(
        "chatAiData",
        session.channelId,
        ["chatContextSize"]
      );
      if (!data) {
        const [channelName, guildName] = await Promise.all([
          this.getChannelName(session),
          this.getGuildName(session),
        ]);
        data = await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName,
          guildId: session.guildId ?? "",
          guildName,
          chatContextSize: 0,
          chatHistory: [],
          aiName: this.defaultAi,
        });
      }
      return data.chatContextSize;
    } finally {
      release();
    }
  }

  async setChatCtxSize(session: Session, chatContextSize: number) {
    const release = await this.mutexDB.acquire();
    try {
      this.#chatContextSize.set(session.channelId, chatContextSize);
      let [data] = await this.ctx.database.get(
        "chatAiData",
        session.channelId,
        ["chatContextSize"]
      );
      if (!data) {
        const [channelName, guildName] = await Promise.all([
          this.getChannelName(session),
          this.getGuildName(session),
        ]);
        data ??= await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName,
          guildId: session.guildId ?? "",
          guildName,
          chatContextSize,
          chatHistory: [],
          aiName: this.defaultAi,
        });
        return data.chatContextSize;
      }
      await this.ctx.database.set("chatAiData", session.channelId, {
        chatContextSize,
      });
      this.refresh();
      return chatContextSize;
    } finally {
      release();
    }
  }

  async getAiName(session: Session) {
    const release = await this.mutexDB.acquire();
    try {
      if (this.#aiName.has(session.channelId))
        return this.#aiName.get(session.channelId);
      let [data] = await this.ctx.database.get(
        "chatAiData",
        session.channelId,
        ["aiName"]
      );
      if (!data) {
        const [channelName, guildName] = await Promise.all([
          this.getChannelName(session),
          this.getGuildName(session),
        ]);
        data = await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName,
          guildId: session.guildId ?? "",
          guildName,
          chatContextSize: 0,
          chatHistory: [],
          aiName: this.defaultAi,
        });
      }
      return data.aiName ?? this.defaultAi;
    } finally {
      release();
    }
  }

  async setAiName(session: Session, aiName: string) {
    const release = await this.mutexDB.acquire();
    try {
      if (session.guildId && this.config.get(aiName).onlyNsfw) {
        if (!session.discord) throw "NSFW 检查只在 Discord 中可用";
        const channel = await session.discord.getChannel(session.channelId);
        if (!channel?.nsfw) throw "无法在这个频道上使用 NSFW AI";
      }
      this.#aiName.set(session.channelId, aiName);
      let [data] = await this.ctx.database.get(
        "chatAiData",
        session.channelId,
        ["aiName"]
      );
      if (!data) {
        const [channelName, guildName] = await Promise.all([
          this.getChannelName(session),
          this.getGuildName(session),
        ]);
        data ??= await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName,
          guildId: session.guildId ?? "",
          guildName,
          chatContextSize: 0,
          chatHistory: [],
          aiName,
        });
        return data.aiName;
      }
      await this.ctx.database.set("chatAiData", session.channelId, {
        aiName,
      });
      this.refresh();
      return aiName;
    } finally {
      release();
    }
  }

  clearContext(session: Session) {
    return this.setChatCtxSize(session, 0);
  }

  async getContext(session: Session) {
    const size = await this.getChatCtxSize(session);
    if (size === 0) return [];
    return (await this.getChatHistory(session)).slice(-size);
  }

  async *genStream(session: Session) {
    const release = await this.mutexAi.acquire();
    const aiName = await this.getAiName(session);
    const config = this.config.get(aiName);
    try {
      if (session.content.length > config.maxPromptLength) {
        yield `提示词太长了，请缩短到 ${config.maxPromptLength} 个字符以内`;
        return;
      }
      if ((await this.getChatCtxSize(session)) > config.maxContextSize * 2) {
        await this.setChatCtxSize(session, config.fitContextSize * 2);
      }
      let username = session.event.user.nick ?? session.event.user.name;
      if (!username) {
        const user = await session.bot?.getUser(session.userId);
        username = user?.nick ?? user?.name ?? session.userId;
      }
      await this.pushChatHistory(session, {
        role: "user",
        content: `${username}:${session.content}`,
        name: username,
      });
      await this.setChatCtxSize(
        session,
        (await this.getChatCtxSize(session)) + 1
      );
      let stream:
        | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
        | AsyncIterable<string>;
      if (!config.isMock) {
        stream = await this.client.get(aiName).chat.completions.create({
          ...config,
          messages: config.systemPrompt.concat(await this.getContext(session)),
          stream: true,
        });
      } else {
        stream = mockAI();
      }
      let fullResponse = "";
      let t = "";
      for await (const chunk of stream) {
        let token: string;
        if (!config.isMock) {
          token =
            (chunk as OpenAI.Chat.Completions.ChatCompletionChunk).choices[0]
              ?.delta?.content || "";
        } else {
          token = chunk as string;
        }
        t += token;
        fullResponse += token;
        if (token.trim() !== "") {
          yield t;
          t = "";
        }
      }
      if (t !== "") yield t;
      this.pushChatHistory(session, {
        role: "assistant",
        content: fullResponse,
        name: config.name,
      });
      await this.setChatCtxSize(
        session,
        (await this.getChatCtxSize(session)) + 1
      );
    } finally {
      release();
    }
  }
}

export async function* mockAI(): AsyncIterable<string> {
  const mockResponse = `# H1

## H2

### H3

**bold text**
*italicized text*
^sdfsdf^
~sdfsdf~
~~strikethrough~~

> blockquote

1. First item
2. Second item
3. Third item

- First item
- Second item
- Third item

\`code\`

---

[title](https://www.example.com)
![alt text](https://s121.top/%E6%B4%BE%E8%92%99.png)

| Syntax      | Description |
| ----------- | ----------- |
| Header      | Title       |
| Paragraph   | Text        |

\`\`\`json
{
  "firstName": "John",
  "lastName": "Smith",
  "age": 25
}
\`\`\`

Here's a sentence with a footnote. [^1]
[^1]: This is the footnote.

### My Great Heading {#custom-id}

term
: definition

~~The world is flat.~~

- [x] Write the press release
- [ ] Update the website
- [ ] Contact the media
`.split("\n");
  for (const line of mockResponse) {
    yield line + "\n";
    await sleep(100);
  }
}
