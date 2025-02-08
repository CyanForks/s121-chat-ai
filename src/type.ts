import OpenAI from "openai";
import { Config } from ".";
import { ChatAIProvider } from "./chat-ai-provider";
import { DatabaseHelper } from "./helper/database";
import {} from "@koishijs/plugin-adapter-discord";

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
  maxRetries: number;
  keywords: string[];
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
  interface Context {
    dbhelper: DatabaseHelper;
    config: Config & { refreshView: (forced?: boolean) => Promise<void> };
    clients: Map<string, OpenAI>;
  }
}

export interface ChatAiData {
  channelId: string;
  channelName: string;
  guildId: string;
  guildName: string;
  chatHistory: PromptItem[];
  chatContextSize: number;
  aiName?: string;
}

declare module "@koishijs/plugin-console" {
  namespace Console {
    interface Services {
      chatai: ChatAIProvider;
    }
  }
}
