import { sleep } from "koishi";

export async function* mockAI(): AsyncIterable<string> {
  const mockResponse = `<think>你还差
打发士大夫孙菲菲瑟夫瑟夫瑟夫

额分色法阿塞飞瑟夫瑟夫ssef

色粉色粉色粉色分f</think># H1

## H2

### H3

**bold text**
*italicized text*
^sdfsdf^
~sdfsdf~
~~strikethrough~~

> blockquote

1. First item
2. Second item
3. Third item

- First item
- Second item
- Third item

\`code\`

---

[title](https://www.example.com)
![alt text](https://s121.top/%E6%B4%BE%E8%92%99.png)

| Syntax      | Description |
| ----------- | ----------- |
| Header      | Title       |
| Paragraph   | Text        |

\`\`\`json
{
  "firstName": "John",
  "lastName": "Smith",
  "age": 25
}
\`\`\`

Here's a sentence with a footnote. [^1]
[^1]: This is the footnote.

### My Great Heading {#custom-id}

term
: definition

~~The world is flat.~~

- [x] Write the press release
- [ ] Update the website
- [ ] Contact the media
`.split("\n");
  for (const line of mockResponse) {
    yield line + "\n";
    await sleep(100);
  }
}
