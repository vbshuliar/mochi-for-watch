import type { Message } from "./domain.ts";
import { z } from "zod";

const storedReply = z
  .object({
    plan: z.object({ kind: z.literal("reply"), text: z.string() }).strict(),
    result: z.object({ state: z.literal("speak"), speechText: z.string() }),
  })
  .strict();

function matchesReply(content: string, expected: string): boolean {
  if (content === expected) return true;
  try {
    const parsed = storedReply.safeParse(JSON.parse(content));
    return (
      parsed.success &&
      parsed.data.plan.text === expected &&
      parsed.data.result.speechText === expected
    );
  } catch {
    return false;
  }
}

function greeting(text: string): string | undefined {
  const normalized = text
    .trim()
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/[,]/g, " ")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(hi|hello|hey)( mochi)?$/.test(normalized)) return "hey, I'm here!";
  if (
    /^(?:(?:hi|hello|hey)(?: mochi)? |mochi )?(?:how are you(?: doing)?(?: today)?|how's it going)$/.test(
      normalized,
    )
  )
    return "I'm here and ready to help—how are you?";
  if (/^(?:mochi )?are you there(?: mochi)?$/.test(normalized))
    return "yes, I'm here and listening.";
}

// Only fresh, self-contained greeting exchanges qualify. Contextual replies,
// instructions (including translation), and truncated histories use the model.
export function quickReply(messages: Message[]): string | undefined {
  if (!messages.length || messages.length % 2 !== 1) return;
  for (let index = 0; index < messages.length; index += 2) {
    const user = messages[index];
    if (user.role !== "user") return;
    const reply = greeting(user.content);
    if (!reply) return;
    if (index === messages.length - 1) return reply;
    const assistant = messages[index + 1];
    if (
      assistant.role !== "assistant" ||
      !matchesReply(assistant.content, reply)
    )
      return;
  }
}
