import { Context, h, Session } from "koishi";
import { canUseAi } from "./can-use-ai";

export async function isCallMyself(ctx: Context, session: Session) {
  if (session.userId === session.selfId) return false;
  const aiName = await ctx.dbhelper.getData(
    session,
    "aiName",
    ctx.config.defaultAi
  );
  const availableAi = ctx.config.aiList.filter(
    ({ canWakeUpByName, name, keywords }) =>
      keywords.some((e) =>
        session.content.toLocaleLowerCase().includes(e.toLocaleLowerCase())
      ) ||
      (canWakeUpByName &&
        session.content.toLocaleLowerCase().includes(name.toLocaleLowerCase()))
  );
  if (availableAi.length === 0) {
    if (!session.guildId) return true;
    const ele = h.select(session.elements, "at");
    return ele.some((e) => e.attrs.id === session.selfId);
  }
  const needChange = availableAi.every(({ name }) => name !== aiName);
  if (needChange) {
    const ai = availableAi.filter(({ name }) => name !== aiName)[0];
    if (await canUseAi(session, ai)) {
      await ctx.dbhelper.setData(session, "aiName", ai.name);
      return true;
    }
    return false;
  }
  return true;
}
