import { Session } from "koishi";
import { AIConfig } from "../type";

export async function canUseAi(session: Session, ai: AIConfig) {
  if (!ai.onlyNsfw) return true;
  if (!session.guildId) return true;
  if (!session.discord) return false;
  const channel = await session.discord.getChannel(session.channelId);
  return channel?.nsfw ?? false;
}
