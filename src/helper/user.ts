import { Session } from "koishi";

export async function getUserName(session: Session) {
  let username = session.event.user.nick ?? session.event.user.name;
  if (!username) {
    const user = await session.bot?.getUser(session.userId);
    username = user?.nick ?? user?.name ?? session.userId;
  }
  return username;
}
