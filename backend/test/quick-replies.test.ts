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
    "thanks",
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
