import { Session } from "koishi";

export async function getChannelName(session: Session) {
  if (session.event.channel?.name) return session.event.channel.name;
  if (session.guildId) {
    const channel = await session.bot.getChannel(session.channelId);
    return channel?.name || session.channelId;
  }
  if (session.event.user?.name) return session.event.user.name;
  const channel = await session.bot.getChannel(session.channelId);
  if (channel?.name) return channel.name;
  const user = await session.bot.getUser(session.event.user.id);
  return user?.name || session.channelId;
}
