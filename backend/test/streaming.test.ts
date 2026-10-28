import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { partialReply, readCompletionStream } from "../src/streaming.ts";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import { AppError, type Planner } from "../src/domain.ts";

test("partial reply decodes escapes but never exposes task payloads", () => {
  assert.equal(
    partialReply('{"kind":"create_event","event":{"title":"hello'),
    "",
  );
  assert.equal(
    partialReply('{"kind":"reply","text":"hello\\nwor'),
    "hello\nwor",
  );
  assert.equal(partialReply('{"kind":"reply","text":"hello\\u00'), "hello");
  assert.equal(partialReply('{"text":"unsafe","kind":"reply"}'), "");
});
test("SSE handles byte boundaries and rejects unfinished completions", async () => {
  const values = ['{"kind":"reply","text":"Hi. ', 'Welcome!"}'];
  const wire =
    values
      .map(
        (content) =>
          "data: " +
          JSON.stringify({ choices: [{ delta: { content } }] }) +
          "\n\n",
      )
      .join("") +
    "data: " +
    JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
    "\n\ndata: [DONE]\n\n";
  const encoder = new TextEncoder(),
    bytes = encoder.encode(wire);
  let at = 0;
  const stream = new ReadableStream({
    pull(c) {
      if (at === bytes.length) {
        c.close();
        return;
      }
      c.enqueue(bytes.slice(at, ++at));
    },
  });
  const seen: string[] = [];
  assert.equal(
    await readCompletionStream(new Response(stream), (text) => seen.push(text)),
    values.join(""),
  );
  assert(seen.includes("Hi. "));
  await assert.rejects(
    readCompletionStream(
      new Response('data: {"choices":[{"delta":{"content":"x"}}]}\n'),
      () => {},
    ),
    /unfinished/,
  );
});
async function setup(t: any, planner: Planner) {
  const cfg = readConfig({
    API_TOKEN: "a".repeat(64),
    ENCRYPTION_KEY: "b".repeat(64),
    DATABASE_PATH: ":memory:",
  });
  const built = await buildApp(cfg, { planner });
  t.after(() => built.app.close());
  const session = built.service.createSession("Europe/London");
  return {
    ...built,
    id: session.id,
    headers: { authorization: "Bearer " + cfg.API_TOKEN },
  };
}
test("cancellation aborts provider, releases session lock and does not retain cancelled answer", async (t) => {
  let started!: () => void;
  const ready = new Promise<void>((r) => (started = r));
  let aborted = false;
  const planner: Planner = {
    transcribe: async () => "",
    plan: async (messages, _tz, options) => {
      if (messages.at(-1)?.content === "new")
        return { kind: "reply", text: "new reply" };
      started();
      await new Promise<void>((_resolve, reject) =>
        options!.signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        ),
      );
      throw new Error("unreachable");
    },
  };
  const f = await setup(t, planner),
    requestId = randomUUID();
  const old = f.service.turn(f.id, requestId, { text: "old" });
  void old.catch(() => {});
  await ready;
  assert.deepEqual(await f.service.cancelTurn(f.id, requestId), {
    cancelled: true,
  });
  await assert.rejects(old);
  assert(aborted);
  assert.equal(f.service.session(f.id).messages.length, 0);
  const next = await f.service.turn(f.id, randomUUID(), { text: "new" });
  assert.equal(next.speechText, "new reply");
});
test("cancel-before-start blocks late dispatch and completed turns remain completed", async (t) => {
  let calls = 0;
  const f = await setup(t, {
    transcribe: async () => "",
    plan: async () => {
      calls++;
      return { kind: "reply", text: "hi" };
    },
  });
  const cancelled = randomUUID();
  await f.service.cancelTurn(f.id, cancelled);
  await assert.rejects(f.service.turn(f.id, cancelled, { text: "hello" }));
  assert.equal(calls, 0);
  const completed = randomUUID();
  await f.service.turn(f.id, completed, { text: "hello" });
  assert.deepEqual(await f.service.cancelTurn(f.id, completed), {
    cancelled: false,
    completed: true,
  });
});
test("stream route emits text then validated result with authenticated cancellation", async (t) => {
  const f = await setup(t, {
    transcribe: async () => "",
    plan: async (_m, _tz, o) => {
      o?.onText?.("Hi. ");
      return { kind: "reply", text: "Hi. Welcome!" };
    },
  });
  const requestId = randomUUID();
  const r = await f.app.inject({
    method: "POST",
    url: `/v1/sessions/${f.id}/stream`,
    headers: f.headers,
    payload: { text: "hello", requestId },
  });
  assert.equal(r.statusCode, 200);
  const events = r.body
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x));
  assert.equal(events[0].type, "text");
  assert.equal(events.at(-1).result.speechText, "Hi. Welcome!");
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/v1/sessions/${f.id}/turns/${requestId}/cancel`,
      })
    ).statusCode,
    401,
  );
});

test("search verification failure has a useful message without leaking provider details", async (t) => {
  const f = await setup(t, {
    transcribe: async () => "",
    plan: async () => {
      throw new AppError(502, "search_unavailable", "private provider details");
    },
  });
  const response = await f.app.inject({
    method: "POST",
    url: `/v1/sessions/${f.id}/stream`,
    headers: f.headers,
    payload: { requestId: randomUUID(), text: "latest news" },
  });
  const event = JSON.parse(response.body.trim());
  assert.equal(event.code, "search_unavailable");
  assert.equal(event.message, "couldn’t verify that online; please try again");
  assert.equal(event.type, "error");
});
