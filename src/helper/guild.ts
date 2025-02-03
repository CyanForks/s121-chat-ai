import { Session } from "koishi";

export async function getGuildName(session: Session) {
  if (session.guildId) {
    const guild = await session.bot.getGuild(session.guildId);
    return guild.name ?? session.guildId;
  }
  return session.text("private-chat");
}
