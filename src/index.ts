import { Context, Schema } from "koishi";
import { resolve } from "path";
import { ChatAIProvider } from "./chat-ai-provider";
import { AIConfig } from "./type";
import { DatabaseHelper } from "./helper/database";

export const name = "chat-ai";
export const inject = ["console", "database"];

export type Config = { defaultAi: string; aiList: AIConfig[] };
export const Config: Schema<Config> = Schema.object({
  defaultAi: Schema.string()
    .required()
    .pattern(/\S/)
    .description("默认使用的智能体名字"),
  aiList: Schema.array(
    Schema.object({
      name: Schema.string()
        .required()
        .pattern(/\S/)
        .description("智能体的名字，可以通过 `/use-agent` 指令来切换"),
      baseURL: Schema.string()
        .role("link")
        .required()
        .pattern(/\S/)
        .description(
          "支持所有与 OpenAI API 兼容的 API 服务，如 ollama、deepseek 等"
        ),
      apiKey: Schema.string()
        .role("secret")
        .required()
        .pattern(/\S/)
        .description("API 密钥，请勿泄露"),
      model: Schema.string().required().pattern(/\S/).description("模型名称"),
      balanceUrl: Schema.string().role("link").description("查询余额的 URL"),
      balanceToken: Schema.string()
        .role("secret")
        .description("查询余额的 token"),
      canWakeUpByName: Schema.boolean()
        .default(false)
        .description("是否可以通过智能体的名字唤醒"),
      onlyNsfw: Schema.boolean()
        .default(false)
        .description("是否仅 NSFW 频道可用"),
      maxContextSize: Schema.number()
        .min(0)
        .default(20)
        .description("上下文最大长度，一问一答算一个上下文"),
      fitContextSize: Schema.number()
        .min(0)
        .default(10)
        .description(
          "截断后的长度，当上下文长度超过最大长度时，截断到这个长度，可以有效增加缓存命中率"
        ),
      systemPrompt: Schema.array(
        Schema.object({
          role: Schema.union([
            Schema.const("system").description("系统消息（可以向 AI 提要求）"),
            Schema.const("user").description(
              "用户提问（与 AI 回答配套使用，给 AI 一些例子）"
            ),
            Schema.const("assistant").description(
              "AI 回答（与用户消息配套使用）"
            ),
          ])
            .role("radio")
            .required()
            .description("角色"),
          content: Schema.string()
            .role("textarea")
            .required()
            .description("内容"),
          name: Schema.string().description("名字"),
        })
      )
        .default([
          {
            name: undefined,
            role: "system",
            content:
              "你是一个可爱的猫娘，你将收到来自多个群聊的消息，我将会以`用户名:输入内容`的形式向你提供这些信息",
          },
          {
            name: "share121",
            role: "user",
            content: "share121:我是谁",
          },
          {
            name: undefined,
            role: "assistant",
            content: "你是 share121 呀",
          },
        ])
        .description(
          "系统提示词，用于初始化上下文，⚠️注意：它不算在上下文长度内，每次请求都会带上"
        ),
      isMock: Schema.boolean()
        .default(false)
        .description("是否使用模拟数据，用于测试"),
      maxPromptLength: Schema.number()
        .default(1000)
        .min(1)
        .description("最大提示词长度"),
      frequencyPenalty: Schema.number()
        .role("slider")
        .min(-2)
        .max(2)
        .step(0.1)
        .default(0)
        .description(
          "如果该值为正，那么新 token 会根据其在已有文本中的出现频率受到相应的惩罚，降低模型重复相同内容的可能性"
        ),
      maxTokens: Schema.number()
        .min(1)
        .default(4096)
        .description("限制一次请求中模型生成 completion 的最大 token 数"),
      presencePenalty: Schema.number()
        .role("slider")
        .min(-2)
        .max(2)
        .step(0.1)
        .default(0)
        .description(
          "如果该值为正，那么新 token 会根据其是否已在已有文本中出现受到相应的惩罚，从而增加模型谈论新主题的可能性"
        ),
      temperature: Schema.number()
        .role("slider")
        .min(0)
        .max(2)
        .step(0.1)
        .default(1)
        .description(
          "采样温度。更高的值，如 0.8，会使输出更随机，而更低的值，如 0.2，会使其更加集中和确定。我们通常建议可以更改这个值或者更改 top_p，但不建议同时对两者进行修改"
        ),
      topP: Schema.number()
        .max(1)
        .step(0.01)
        .default(1)
        .description(
          "作为调节采样温度的替代方案，模型会考虑前 top_p 概率的 token 的结果。所以 0.1 就意味着只有包括在最高 10% 概率中的 token 会被考虑。 我们通常建议修改这个值或者更改 temperature，但不建议同时对两者进行修改。"
        ),
    })
  ).default([
    {
      name: "neko",
      apiKey: undefined,
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com",
      maxContextSize: 10,
      onlyNsfw: false,
      fitContextSize: 5,
      maxTokens: 100,
      balanceUrl: "https://api.deepseek.com/user/balance",
      balanceToken: undefined,
      systemPrompt: [
        {
          name: undefined,
          role: "system",
          content:
            "你是一个猫娘 neko，你将收到来自多个群聊的消息，我将会以`用户名:输入内容`的形式向你提供这些信息",
        },
        {
          name: "share121",
          role: "user",
          content: "share121:我是谁",
        },
        {
          name: "neko",
          role: "assistant",
          content: "你是 share121 呀！",
        },
      ],
      canWakeUpByName: true,
      temperature: 1.7,
      presencePenalty: 2,
      frequencyPenalty: 2,
      isMock: false,
      maxPromptLength: 1000,
      topP: 1,
    },
    {
      name: "deepseek-v3",
      apiKey: undefined,
      model: "deepseek-chat",
      baseURL: "https://api.deepseek.com",
      onlyNsfw: false,
      maxContextSize: 10,
      fitContextSize: 5,
      maxTokens: 100,
      balanceUrl: "https://api.deepseek.com/user/balance",
      balanceToken: undefined,
      systemPrompt: [
        {
          name: undefined,
          role: "system",
          content:
            "你将收到来自多个群聊的消息，我将会以`用户名:输入内容`的形式向你提供这些信息",
        },
        {
          name: "share121",
          role: "user",
          content: "share121:我是谁",
        },
        {
          name: "deepseek-v3",
          role: "assistant",
          content: "你是 share121",
        },
      ],
      canWakeUpByName: true,
      frequencyPenalty: 2,
      presencePenalty: 2,
      temperature: 1.7,
      isMock: false,
      maxPromptLength: 1000,
      topP: 1,
    },
  ]),
}).description("AI 配置");

export function apply(ctx: Context, config: Config) {
  ctx.clients = new Map();
  ctx.dbhelper = new DatabaseHelper(ctx);

  ctx.i18n.define("en-US", require("./locales/en-US"));
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

  ctx.plugin(ChatAIProvider, config);

  ctx.model.extend(
    "chatAiData",
    {
      channelId: {
        type: "string",
        nullable: false,
      },
      channelName: {
        type: "string",
        nullable: false,
      },
      guildId: {
        type: "string",
        nullable: false,
      },
      guildName: {
        type: "string",
        nullable: false,
      },
      chatHistory: {
        type: "array",
        initial: [],
        nullable: false,
      },
      chatContextSize: {
        type: "unsigned",
        initial: 0,
        nullable: false,
      },
      aiName: {
        type: "string",
        nullable: true,
      },
    },
    {
      primary: "channelId",
    }
  );

  ctx.console.addEntry({
    dev: resolve(__dirname, "../client/index.ts"),
    prod: resolve(__dirname, "../dist"),
  });
}
