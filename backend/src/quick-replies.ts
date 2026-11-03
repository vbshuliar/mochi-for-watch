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

// Fixed public small-talk text only: never facts, task confirmations or action receipts.
const categories: { reply: string; phrases: string[] }[] = [
  {
    reply: "hello",
    phrases: [
      "hi",
      "hello",
      "hey",
      "hiya",
      "heya",
      "howdy",
      "greetings",
      "yo",
      "hey there",
      "hi there",
      "hello there",
      "good morning",
      "morning",
      "good afternoon",
      "afternoon",
      "good evening",
      "evening",
      "hello again",
      "hi again",
      "hey again",
      "nice to meet you",
      "pleased to meet you",
      "good to see you",
      "nice to see you",
      "long time no see",
    ],
  },
  {
    reply: "I'm here and ready to help—how are you?",
    phrases: [
      "how are you",
      "how are you doing",
      "how are you today",
      "how are you doing today",
      "how are you feeling",
      "how are you feeling today",
      "how have you been",
      "how've you been",
      "how you been",
      "how have things been",
      "how has it been",
      "how's it been",
      "how is it going",
      "how's it going",
      "how are things",
      "how's everything",
      "how is everything",
      "how's life",
      "how is life",
      "how are you getting on",
      "how are you keeping",
      "how do you do",
      "how's your day",
      "how is your day",
      "how's your day going",
      "how is your day going",
      "how was your day",
      "how has your day been",
      "how's your day been",
      "how was your morning",
      "how was your evening",
      "how was your weekend",
      "what's up",
      "what is up",
      "whatsup",
      "sup",
      "what's new",
      "what is new",
      "what's happening",
      "what's going on",
      "you doing well",
      "are you doing well",
      "are you okay",
      "are you ok",
      "you alright",
      "are you alright",
    ],
  },
  {
    reply: "yes, I'm here and listening.",
    phrases: [
      "are you there",
      "you there",
      "are you here",
      "are you listening",
      "can you hear me",
      "do you hear me",
      "can you hear me now",
      "are you awake",
      "you awake",
      "are you ready",
      "ready",
      "are you still there",
      "hello can you hear me",
    ],
  },
  {
    reply: "I'm Mochi, your AI assistant.",
    phrases: [
      "who are you",
      "what are you",
      "what's your name",
      "what is your name",
      "what do I call you",
      "what should I call you",
      "introduce yourself",
      "tell me your name",
      "are you mochi",
    ],
  },
  {
    reply: "I'm an AI assistant, not a person.",
    phrases: [
      "are you an ai",
      "are you ai",
      "are you a robot",
      "are you human",
      "are you a person",
      "are you real",
      "are you alive",
      "are you a real person",
    ],
  },
  {
    reply: "I can chat, help with plans, and work on tasks you ask me to do.",
    phrases: [
      "what can you do",
      "what do you do",
      "how can you help",
      "how can you help me",
      "what can you help with",
      "what can you help me with",
      "what are your capabilities",
      "tell me what you can do",
    ],
  },
  {
    reply: "you're welcome!",
    phrases: [
      "thanks",
      "thank you",
      "thanks a lot",
      "thank you so much",
      "thanks so much",
      "many thanks",
      "thank you very much",
      "thanks very much",
      "cheers",
      "much appreciated",
      "I appreciate it",
      "I appreciate you",
    ],
  },
  {
    reply: "bye, talk soon!",
    phrases: [
      "bye",
      "goodbye",
      "bye bye",
      "see you",
      "see you later",
      "see you soon",
      "talk to you later",
      "talk soon",
      "catch you later",
      "have a nice day",
      "have a good day",
      "have a good evening",
      "good night",
      "goodnight",
      "night night",
      "take care",
    ],
  },
  {
    reply: "thank you, that's kind of you!",
    phrases: [
      "you're great",
      "you are great",
      "you're awesome",
      "you are awesome",
      "you're amazing",
      "you are amazing",
      "you're cute",
      "you are cute",
      "you're the best",
      "you are the best",
      "good job",
      "well done",
      "I like you",
      "I love you",
      "love you",
    ],
  },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const replies = new Map(
  categories.flatMap(({ reply, phrases }) =>
    phrases.map((phrase) => [normalize(phrase), reply] as const),
  ),
);
const greetings = categories[0].phrases
  .map(normalize)
  .sort((a, b) => b.length - a.length);

function smallTalk(text: string): string | undefined {
  if (text.length > 300) return;
  // Addressing Mochi and greeting prefixes don't change the intent. The remaining
  // text must still be an exact phrase; "hello, book a haircut" cannot match.
  const addressed = normalize(text)
    .replace(/^mochi /, "")
    .replace(/ mochi$/, "");
  const direct = replies.get(addressed);
  if (direct) return direct;
  for (const prefix of greetings) {
    if (addressed.startsWith(prefix + " ")) {
      const rest = addressed.slice(prefix.length + 1).replace(/^mochi /, "");
      const reply = replies.get(rest);
      if (reply) return reply;
    }
  }
}

// Only fresh, self-contained small-talk exchanges qualify. Contextual replies,
// instructions (including translation), and truncated histories use the model.
export function quickReply(messages: Message[]): string | undefined {
  if (!messages.length || messages.length % 2 !== 1) return;
  for (let index = 0; index < messages.length; index += 2) {
    const user = messages[index];
    if (user.role !== "user") return;
    const reply = smallTalk(user.content);
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
