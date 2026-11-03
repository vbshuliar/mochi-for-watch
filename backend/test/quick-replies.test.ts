import test from "node:test";
import assert from "node:assert/strict";
import { MetaPlanner } from "../src/meta.ts";
import { readConfig } from "../src/config.ts";
import { quickReply } from "../src/quick-replies.ts";
import { buildApp } from "../src/app.ts";
import { randomUUID } from "node:crypto";

const config = readConfig({
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  DATABASE_PATH: ":memory:",
});
test("consecutive service turns use stored reply envelopes without calling a provider", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected provider request");
  });
  const built = await buildApp(config, { planner: new MetaPlanner(config) });
  t.after(() => built.app.close());
  const session = built.service.createSession("UTC");
  await built.service.turn(session.id, randomUUID(), { text: "hello" });
  const result = await built.service.turn(session.id, randomUUID(), {
    text: "how are you?",
  });
  assert.equal(result.speechText, "I'm here and ready to help—how are you?");
  assert.equal(built.service.session(session.id).messages.length, 4);
});
test("whole greetings return immediately without a provider request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected provider request");
  });
  const planner = new MetaPlanner(config);
  for (const text of [
    "How are you?",
    "Hi Mochi, how are you today?",
    "Hello!",
    "Hey, Mochi!",
    "Are you there?",
    "  HOW’S IT GOING?!  ",
  ]) {
    const streamed: string[] = [];
    const plan = await planner.plan([{ role: "user", content: text }], "UTC", {
      onText: (value) => streamed.push(value),
    });
    assert.equal(plan.kind, "reply");
    assert.deepEqual(streamed, [(plan as { text: string }).text]);
  }
});
test("greeting exchanges remain fast but context and mixed requests never match", () => {
  const hello = quickReply([{ role: "user", content: "hello" }])!;
  assert(hello);
  assert(
    quickReply([
      { role: "user", content: "hello" },
      { role: "assistant", content: hello },
      { role: "user", content: "how are you?" },
    ]),
  );
  for (const text of [
    "Hi, book a haircut",
    "How are you booking my haircut?",
    "Tell Alex how are you",
    "Translate how are you",
    "No, how are you?",
    "how are you feeling about what I said?",
    "hi\nplease call someone",
    "yes",
  ]) {
    assert.equal(
      quickReply([{ role: "user", content: text }]),
      undefined,
      text,
    );
  }
  for (const previous of [
    "Translate everything I say into French",
    "I feel awful",
    "Book me a haircut",
  ]) {
    assert.equal(
      quickReply([
        { role: "user", content: previous },
        { role: "assistant", content: "Tell me more." },
        { role: "user", content: "how are you?" },
      ]),
      undefined,
    );
  }
  // Truncated history cannot be mistaken for a new conversation.
  assert.equal(
    quickReply([
      { role: "assistant", content: hello },
      { role: "user", content: "hello" },
    ]),
    undefined,
  );
});
test("cancelled quick greetings emit no speech", async () => {
  const controller = new AbortController();
  controller.abort();
  const streamed: string[] = [];
  await assert.rejects(
    new MetaPlanner(config).plan(
      [{ role: "user", content: "how are you?" }],
      "UTC",
      { signal: controller.signal, onText: (text) => streamed.push(text) },
    ),
  );
  assert.deepEqual(streamed, []);
});

test("expanded small-talk categories share consistent replies across phrasing", () => {
  const groups: [string, string[]][] = [
    [
      "hello",
      [
        "Good morning!",
        "hiya",
        "Howdy, Mochi!",
        "Mochi, hello",
        "Hey there",
        "Nice to meet you",
        "Hello again",
      ],
    ],
    [
      "I'm here and ready to help—how are you?",
      [
        "How have you been?",
        "How's it been?",
        "How has it been?",
        "How was your weekend?",
        "What's up?",
        "How is everything?",
        "Are you okay?",
        "Hey Mochi, how've you been?",
        "Good evening. How has your day been, Mochi?",
        "how you been",
      ],
    ],
    [
      "yes, I'm here and listening.",
      [
        "You there?",
        "Can you hear me now?",
        "Mochi, are you awake?",
        "Hey, are you listening?",
      ],
    ],
    [
      "I'm Mochi, your AI assistant.",
      [
        "Who are you?",
        "What's your name?",
        "Introduce yourself",
        "What should I call you?",
      ],
    ],
    [
      "I'm an AI assistant, not a person.",
      ["Are you human?", "Are you an AI?", "Are you a real person?"],
    ],
    [
      "I can chat, help with plans, and work on tasks you ask me to do.",
      [
        "What can you do?",
        "How can you help me?",
        "What are your capabilities?",
      ],
    ],
    [
      "you're welcome!",
      ["Thanks so much!", "Thank you very much, Mochi", "Cheers"],
    ],
    ["bye, talk soon!", ["Goodnight", "See you later", "Have a nice day"]],
    [
      "thank you, that's kind of you!",
      ["You're the best!", "I love you", "Well done"],
    ],
  ];
  for (const [expected, phrases] of groups)
    for (const content of phrases)
      assert.equal(quickReply([{ role: "user", content }]), expected, content);
  for (const content of [
    "Hi, what's the weather?",
    "How has my booking been going?",
    "Thanks, cancel the call",
    "Good morning, book me a haircut",
    "What is new in the news?",
    "Are you ready to call?",
    "What can you do about my appointment?",
    "I'm not okay",
    "I don't love you",
    "yes please",
    "what time is it",
  ])
    assert.equal(quickReply([{ role: "user", content }]), undefined, content);
});
