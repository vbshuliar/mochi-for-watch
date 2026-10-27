import { AppError } from "./domain.ts";

// Only plain reply text is eligible for early output; never expose task fields.
export function partialReply(source: string): string {
  const match = /^\s*\{\s*"kind"\s*:\s*"reply"\s*,\s*"text"\s*:\s*"/.exec(
    source,
  );
  if (!match) return "";
  const rest = source.slice(match[0].length);
  let escaped = false,
    end = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (!escaped && rest[i] === '"') {
      end = i;
      break;
    }
    if (!escaped && rest[i] === "\\") escaped = true;
    else escaped = false;
  }
  // At most one incomplete JSON escape (six characters) can trail a delta.
  for (let trim = 0; trim <= 6 && end >= trim; trim++) {
    try {
      return JSON.parse('"' + rest.slice(0, end - trim) + '"');
    } catch {}
  }
  return "";
}
export async function readCompletionStream(
  response: Response,
  onText: (text: string) => void,
) {
  if (!response.ok || !response.body)
    throw new AppError(502, "stream_failed", "reply unavailable");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    content = "",
    finish: string | null = null,
    emitted = "";
  const line = (value: string) => {
    if (!value.startsWith("data:")) return;
    const data = value.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data),
      choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === "string")
      content += choice.delta.content;
    if (content.length > 16000) throw new Error("reply too large");
    if (choice?.finish_reason) finish = choice.finish_reason;
    const text = partialReply(content);
    if (text && text !== emitted) {
      emitted = text;
      onText(text);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      if (buffer.length > 100000) throw new Error("stream frame too large");
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const item of lines) line(item.trimEnd());
      if (done) {
        if (buffer) line(buffer);
        break;
      }
    }
    if (finish !== "stop") throw new Error("unfinished reply");
    if (emitted) {
      const final = JSON.parse(content);
      if (
        final.kind !== "reply" ||
        typeof final.text !== "string" ||
        !final.text.startsWith(emitted)
      )
        throw new Error("stream changed response type");
    }
    return content;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
