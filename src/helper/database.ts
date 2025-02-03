/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Mutex } from "async-mutex";
import { Context, Session } from "koishi";
import { getChannelName } from "./channel";
import { getGuildName } from "./guild";
import { ChatAiData, PromptItem } from "../type";

export class DatabaseHelper {
  private mutex = new Mutex();

  constructor(private ctx: Context) {}

  async createNewRecord<T extends keyof ChatAiData>(
    session: Session,
    field: T,
    value: ChatAiData[T]
  ) {
    const [channelName, guildName] = await Promise.all([
      getChannelName(session),
      getGuildName(session),
    ]);
    return {
      channelId: session.channelId,
      channelName,
      guildId: session.guildId ?? "",
      guildName,
      chatContextSize: 0,
      chatHistory: [],
      aiName: this.ctx.config.defaultAi,
      [field]: value,
    };
  }

  async getData<T extends keyof ChatAiData>(
    session: Session,
    field: T,
    defaultValue: ChatAiData[T]
  ): Promise<ChatAiData[T]> {
    const release = await this.mutex.acquire();
    try {
      const [data] = await this.ctx.database.get(
        "chatAiData",
        session.channelId,
        [field]
      );
      // @ts-ignore
      if (data) return data[field] ?? defaultValue;
      await this.ctx.database.create(
        "chatAiData",
        await this.createNewRecord(session, field, defaultValue)
      );
      return defaultValue;
    } finally {
      release();
    }
  }

  async setData<T extends keyof ChatAiData>(
    session: Session,
    field: T,
    value: ChatAiData[T]
  ): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      const exists = await this.ctx.database.get(
        "chatAiData",
        session.channelId
      );
      if (exists.length > 0) {
        if (exists[0][field] === value) return;
        await this.ctx.database.set("chatAiData", session.channelId, {
          [field]: value,
        });
        return;
      }
      await this.ctx.database.create(
        "chatAiData",
        await this.createNewRecord(session, field, value)
      );
    } finally {
      try {
        await this.ctx.config.refreshView();
      } finally {
        release();
      }
    }
  }

  async pushChatHistory(session: Session, ...chatHistory: PromptItem[]) {
    const old = await this.getData(session, "chatHistory", []);
    await this.setData(session, "chatHistory", old.concat(chatHistory));
  }

  async chatCtxSizePlusOne(session: Session) {
    const old = await this.getData(session, "chatContextSize", 0);
    await this.setData(session, "chatContextSize", old + 1);
    return old + 1;
  }

  async clearContext(session: Session) {
    await this.setData(session, "chatContextSize", 0);
  }

  async getContext(session: Session) {
    const size = await this.getData(session, "chatContextSize", 0);
    if (size === 0) return [];
    return (await this.getData(session, "chatHistory", [])).slice(-size);
  }
}
