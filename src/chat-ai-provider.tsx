import { DataService } from "@koishijs/plugin-console";
import { $, Context, h, Session } from "koishi";
import OpenAI from "openai";
import { Mutex } from "async-mutex";
import { Stream } from "openai/streaming.mjs";
import {} from "@koishijs/plugin-adapter-discord";
import axios from "axios";

export interface PromptItem {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
}

export interface AIConfig {
  baseURL: string;
  apiKey: string;
  model: string;
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
}

declare module "@koishijs/plugin-console" {
  namespace Console {
    interface Services {
      chatai: ChatAIProvider;
    }
  }
}

export class ChatAIProvider extends DataService<ChatAiData[]> {
  client: OpenAI;
  mutexAi = new Mutex();
  mutexDB = new Mutex();
  declare config: AIConfig;
  #chatHistory = new Map<string, PromptItem[]>();
  #chatContextSize = new Map<string, number>();

  constructor(ctx: Context, config: AIConfig) {
    super(ctx, "chatai");
    this.client = new OpenAI(config);
    this.config = config;

    ctx.command("chat-ai <prompt:text>").action(async ({ session }, prompt) => {
      session.content = prompt;
      if (!session.discord) {
        const res = await this.genAsync(session);
        return await session.send(res);
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

    ctx.command("chat-ai/balance").action(async ({ session }) => {
      if (!this.config.balanceUrl || !this.config.balanceToken) {
        return session.text(".balance-not-configured");
      }
      const balance = await axios
        .get(this.config.balanceUrl, {
          method: "get",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.config.balanceToken}`,
          },
        })
        .then((r) => JSON.stringify(r.data, null, 2));
      return (
        <>
          {session.text(".balance-is")}
          <code-block language="json">{balance}</code-block>
        </>
      );
    });

    ctx.on("message", async (session) => {
      if (!this.isCallMyself(session)) return;
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

  isCallMyself(session: Session) {
    if (session.userId === session.selfId) return false;
    const ele = h.select(session.elements, "at");
    return ele.some((e) => e.attrs.id === session.selfId);
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
        const [channel, guild] = await Promise.all([
          session.bot.getChannel(session.channelId),
          session.bot.getGuild(session.guildId),
        ]);
        data = await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName: channel.name ?? session.channelId,
          guildId: session.guildId,
          guildName: guild.name ?? session.guildId,
          chatContextSize: 0,
          chatHistory: [],
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
        const [channel, guild] = await Promise.all([
          session.bot.getChannel(session.channelId),
          session.bot.getGuild(session.guildId),
        ]);
        data = await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName: channel.name ?? session.channelId,
          guildId: session.guildId,
          guildName: guild.name ?? session.guildId,
          chatContextSize: 0,
          chatHistory,
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
        const [channel, guild] = await Promise.all([
          session.bot.getChannel(session.channelId),
          session.bot.getGuild(session.guildId),
        ]);
        data = await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName: channel.name ?? session.channelId,
          guildId: session.guildId,
          guildName: guild.name ?? session.guildId,
          chatContextSize: 0,
          chatHistory: [],
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
        const [channel, guild] = await Promise.all([
          session.bot.getChannel(session.channelId),
          session.bot.getGuild(session.guildId),
        ]);
        data ??= await this.ctx.database.create("chatAiData", {
          channelId: session.channelId,
          channelName: channel.name ?? session.channelId,
          guildId: session.guildId,
          guildName: guild.name ?? session.guildId,
          chatContextSize,
          chatHistory: [],
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
    try {
      if (session.content.length > this.config.maxPromptLength) {
        yield `提示词太长了，请缩短到 ${this.config.maxPromptLength} 个字符以内`;
        return;
      }
      if (
        (await this.getChatCtxSize(session)) >
        this.config.maxContextSize * 2
      ) {
        await this.setChatCtxSize(session, this.config.fitContextSize * 2);
      }
      const user = await session.bot.getUser(session.userId);
      const username = user.nick ?? user.name ?? user.id;
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
      if (!this.config.isMock) {
        stream = await this.client.chat.completions.create({
          ...this.config,
          messages: this.config.systemPrompt.concat(
            await this.getContext(session)
          ),
          stream: true,
        });
      } else {
        stream = mockAI();
      }
      let fullResponse = "";
      let t = "";
      for await (const chunk of stream) {
        let token: string;
        if (!this.config.isMock) {
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
        name: this.config.model,
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

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
