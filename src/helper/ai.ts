import { Mutex } from "async-mutex";
import { Context, Session } from "koishi";
import { getUserName } from "./user";
import { Stream } from "openai/streaming.mjs";
import OpenAI from "openai";
import { mockAI } from "./mock-ai";

const mutex = new Mutex();

export async function* genStream(ctx: Context, session: Session) {
  const release = await mutex.acquire();
  const aiName = await ctx.dbhelper.getData(
    session,
    "aiName",
    ctx.config.defaultAi
  );
  const config = ctx.config.aiList.find(({ name }) => name === aiName);
  if (!config) {
    yield session.text("commands.use-agent.messages.agent-not-found", [aiName]);
    return;
  }
  try {
    if (session.content.length > config.maxPromptLength) {
      yield session.text("prompt-too-long", [config.maxPromptLength]);
      return;
    }
    if (
      (await ctx.dbhelper.getData(session, "chatContextSize", 0)) >
      config.maxContextSize * 2
    ) {
      await ctx.dbhelper.setData(
        session,
        "chatContextSize",
        config.fitContextSize * 2
      );
    }
    const username = await getUserName(session);
    await ctx.dbhelper.pushChatHistory(session, {
      role: "user",
      content: `${username}：${session.content}`,
      name: username,
    });
    await ctx.dbhelper.chatCtxSizePlusOne(session);
    let stream:
      | Stream<OpenAI.Chat.Completions.ChatCompletionChunk>
      | AsyncIterable<string>;
    if (!config.isMock) {
      stream = await ctx.clients.get(aiName).chat.completions.create({
        ...config,
        messages: config.systemPrompt.concat(
          await ctx.dbhelper.getContext(session)
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
    await ctx.dbhelper.pushChatHistory(session, {
      role: "assistant",
      content: fullResponse,
      name: config.name,
    });
    await ctx.dbhelper.chatCtxSizePlusOne(session);
  } finally {
    release();
  }
}

export async function genAsync(ctx: Context, session: Session) {
  const stream = genStream(ctx, session);
  let res = "";
  for await (const chunk of stream) res += chunk;
  return res;
}
