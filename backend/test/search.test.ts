import { test } from "node:test";
import assert from "node:assert/strict";
import { MetaPlanner } from "../src/meta.ts";
import { readConfig } from "../src/config.ts";

const config = readConfig({
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  MODEL_API_KEY: "test",
  DATABASE_PATH: ":memory:",
});
const citation = {
  type: "url_citation",
  title: "Official announcement",
  url: "https://example.com/news",
};
const completed = (output: unknown[]) => ({ status: "completed", output });
const answer = (annotations: unknown[] = [citation]) => ({
  type: "message",
  role: "assistant",
  content: [
    { type: "output_text", text: "the museum opens today.", annotations },
  ],
});
const searched = { type: "web_search_call", status: "completed" };
function mock(
  t: any,
  response: unknown,
  onRequest?: (body: any, init: RequestInit) => void,
) {
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (++calls === 1)
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  kind: "web_search",
                  query: "museum opening today",
                }),
              },
            },
          ],
        });
      onRequest?.(body, init);
      return Response.json(response);
    },
  );
}
test("search plan uses Meta Responses and carries genuine citations", async (t) => {
  mock(t, completed([searched, answer()]), (body) => {
    assert.equal(body.tools[0].type, "web_search");
    assert.equal(body.store, false);
    assert.equal(body.max_tool_calls, 2);
  });
  const result = await new MetaPlanner(config).plan(
    [{ role: "user", content: "Is the museum open today?" }],
    "Europe/London",
  );
  assert.equal(result.kind, "reply");
  assert.deepEqual((result as any).sources, [
    { title: citation.title, url: citation.url },
  ]);
});
test("search never returns an ungrounded or incomplete answer", async (t) => {
  for (const response of [
    completed([answer()]),
    completed([searched, answer([])]),
    { status: "incomplete", output: [searched, answer()] },
  ]) {
    mock(t, response);
    await assert.rejects(
      new MetaPlanner(config).plan(
        [{ role: "user", content: "latest news" }],
        "UTC",
      ),
    );
    t.mock.restoreAll();
  }
});
test("rejects unsafe source URLs and keeps caller cancellation", async (t) => {
  const controller = new AbortController();
  mock(
    t,
    completed([
      searched,
      answer([{ ...citation, url: "javascript:alert(1)" }]),
    ]),
    (_body, init) => {
      assert(init.signal);
      controller.abort();
      assert.equal(init.signal!.aborted, true);
    },
  );
  await assert.rejects(
    new MetaPlanner(config).plan([{ role: "user", content: "search" }], "UTC", {
      signal: controller.signal,
    }),
  );
});
test("ordinary replies do not call search", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"kind":"reply","text":"hello!"}' },
        },
      ],
    });
  });
  assert.equal(
    (
      await new MetaPlanner(config).plan(
        [{ role: "user", content: "hello" }],
        "UTC",
      )
    ).kind,
    "reply",
  );
  assert.equal(calls, 1);
});

test("streamed search waits for verified completion and survives split UTF-8 frames", async (t) => {
  let calls = 0;
  const texts: string[] = [];
  const events = [
    { type: "response.output_text.delta", delta: "unverified draft" },
    { type: "response.completed", response: completed([searched, answer()]) },
  ];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      assert.equal(body.stream, true);
      if (++calls === 1)
        return new Response(
          "data: " +
            JSON.stringify({
              choices: [
                {
                  delta: {
                    content:
                      '{"kind":"web_search","query":"current museum hours"}',
                  },
                  finish_reason: "stop",
                },
              ],
            }) +
            "\n\n",
        );
      const bytes = new TextEncoder().encode(
        events.map((e) => "data: " + JSON.stringify(e) + "\r\n\r\n").join(""),
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            for (let i = 0; i < bytes.length; i += 7)
              controller.enqueue(bytes.slice(i, i + 7));
            controller.close();
          },
        }),
      );
    },
  );
  const result = await new MetaPlanner(config).plan(
    [{ role: "user", content: "museum hours" }],
    "UTC",
    { onText: (text) => texts.push(text) },
  );
  assert.deepEqual(texts, ["the museum opens today."]);
  assert.equal((result as any).sources.length, 1);
});
test("search stream fails closed on truncation or provider failure", async () => {
  const { readSearchStream } = await import("../src/search.ts");
  for (const event of [
    { type: "response.output_text.delta", delta: "guess" },
    { type: "response.failed" },
    { type: "response.incomplete" },
  ]) {
    await assert.rejects(
      readSearchStream(new Response("data: " + JSON.stringify(event) + "\n\n")),
      (error: any) => error.code === "search_unavailable",
    );
  }
});
test("model-authored source links on an ordinary reply are discarded", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              kind: "reply",
              text: "hello!",
              sources: [{ title: "Invented", url: "https://example.com" }],
            }),
          },
        },
      ],
    }),
  );
  const result = await new MetaPlanner(config).plan(
    [{ role: "user", content: "hello" }],
    "UTC",
  );
  assert.equal((result as any).sources, undefined);
});
test("source links survive service validation and cached turn retries", async (t) => {
  const { Service } = await import("../src/service.ts");
  const { Store } = await import("../src/store.ts");
  const { MockCalendar } = await import("../src/calendar.ts");
  const store = new Store(":memory:", "b".repeat(64));
  t.after(() => store.close());
  const planner = {
    transcribe: async () => "",
    plan: async () => ({
      kind: "reply" as const,
      text: "current answer",
      sources: [{ title: "Source", url: "https://example.com" }],
    }),
  };
  const service = new Service(store, planner, new MockCalendar(), true);
  const session = service.createSession("UTC");
  const first = await service.turn(session.id, "search-test", {
    text: "latest?",
  });
  assert.equal(first.sources?.[0].url, "https://example.com");
  assert.deepEqual(
    (await service.turn(session.id, "search-test", { text: "latest?" }))
      .sources,
    first.sources,
  );
});

test("search excludes progress commentary from spoken answer and sources", async (t) => {
  mock(
    t,
    completed([
      {
        ...answer(),
        phase: "commentary",
        content: [
          {
            type: "output_text",
            text: "I will search now.",
            annotations: [{ ...citation, url: "https://example.com/progress" }],
          },
        ],
      },
      searched,
      answer(),
    ]),
  );
  const result = await new MetaPlanner(config).plan(
    [{ role: "user", content: "latest?" }],
    "UTC",
  );
  assert.equal((result as any).text, "the museum opens today.");
  assert.deepEqual((result as any).sources, [
    { title: citation.title, url: citation.url },
  ]);
});

test("missing annotations use labelled provider retrieval results, never invented links", async (t) => {
  mock(
    t,
    completed([
      {
        ...searched,
        results: [
          {
            type: "text_result",
            title: "Official source",
            url: "https://example.com/official",
          },
          {
            type: "text_result",
            title: "Duplicate",
            url: "https://example.com/official",
          },
          { type: "text_result", title: "Unsafe", url: "javascript:alert(1)" },
        ],
      },
      answer([]),
    ]),
    (body) => assert.deepEqual(body.include, ["web_search_call.results"]),
  );
  const result = await new MetaPlanner(config).plan(
    [{ role: "user", content: "current president" }],
    "UTC",
  );
  assert.deepEqual((result as any).sources, [
    {
      title: "Search result · Official source",
      url: "https://example.com/official",
    },
  ]);
});

test("failed search hits are not accepted as fallback sources", async (t) => {
  mock(
    t,
    completed([
      searched,
      {
        type: "web_search_call",
        status: "failed",
        results: [
          {
            type: "text_result",
            title: "Not retrieved",
            url: "https://example.com",
          },
        ],
      },
      answer([]),
    ]),
  );
  await assert.rejects(
    new MetaPlanner(config).plan(
      [{ role: "user", content: "current news" }],
      "UTC",
    ),
  );
});

test("citations take precedence over unrelated retrieved results", async (t) => {
  mock(
    t,
    completed([
      {
        ...searched,
        results: [
          {
            type: "text_result",
            title: "Other result",
            url: "https://example.com/other",
          },
        ],
      },
      answer(),
    ]),
  );
  const result = await new MetaPlanner(config).plan(
    [{ role: "user", content: "current news" }],
    "UTC",
  );
  assert.deepEqual((result as any).sources, [
    { title: citation.title, url: citation.url },
  ]);
});
