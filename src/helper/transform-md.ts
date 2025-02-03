export function transformMd(str: string) {
  return str
    .replace(/<think>(.*?)<\/think>/gs, (_, p1) => {
      return "\n" + p1.replace(/^/gm, "> ") + "\n";
    })
    .replace(/\n+/g, "\n");
}
