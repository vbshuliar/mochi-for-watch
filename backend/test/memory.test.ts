import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import type { Planner, Memory } from "../src/domain.ts";
const config = readConfig({
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  DATABASE_PATH: ":memory:",
});
const headers = { authorization: `Bearer ${config.API_TOKEN}` };
const planner: Planner = {
  transcribe: async () => "",
  plan: async (messages, _tz, options) => {
    const text = messages.at(-1)!.content;
    if (text === "remember London")
      return {
        kind: "remember",
        memory: { title: "Home city", text: "I live in London" },
      };
    return {
      kind: "reply",
      text: options?.memories?.map((m) => m.text).join("; ") || "no memory",
    };
  },
};
test("memory is shared across sessions; edits and deletes clear stale context", async (t) => {
  const f = await buildApp(config, { planner });
  t.after(() => f.app.close());
  const a = f.service.createSession("UTC"),
    b = f.service.createSession("UTC");
  await f.service.turn(a.id, randomUUID(), { text: "remember London" });
  assert.equal(f.service.memories().length, 1);
  assert.equal(
    (await f.service.turn(b.id, randomUUID(), { text: "where?" })).speechText,
    "I live in London",
  );
  const m = f.service.memories()[0];
  const edit = await f.app.inject({
    method: "PATCH",
    url: `/v1/memories/${m.id}`,
    headers,
    payload: { title: "Home city", text: "I live in Bristol" },
  });
  assert.equal(edit.statusCode, 200);
  assert.deepEqual(f.service.session(b.id).messages, []);
  assert.equal(
    (await f.service.turn(a.id, randomUUID(), { text: "where?" })).speechText,
    "I live in Bristol",
  );
  await f.app.inject({
    method: "DELETE",
    url: `/v1/memories/${m.id}`,
    headers,
  });
  assert.equal(
    (await f.service.turn(b.id, randomUUID(), { text: "where?" })).speechText,
    "no memory",
  );
});
test("memory API authentication, validation, deduplication and forget-all", async (t) => {
  const f = await buildApp(config, { planner });
  t.after(() => f.app.close());
  assert.equal(
    (await f.app.inject({ method: "GET", url: "/v1/memories" })).statusCode,
    401,
  );
  for (const payload of [
    { title: "", text: "x" },
    { title: "x", text: "x".repeat(501) },
    { title: "x", text: "y", extra: true },
  ])
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/v1/memories",
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
  f.service.saveMemory({ title: "Home city", text: "London" });
  f.service.saveMemory({ title: "home city", text: "Bristol" });
  assert.equal(f.service.memories().length, 1);
  assert.equal(
    (
      await f.app.inject({
        method: "PATCH",
        url: `/v1/memories/${randomUUID()}`,
        headers,
        payload: { title: "x", text: "y" },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (await f.app.inject({ method: "DELETE", url: "/v1/memories", headers }))
      .statusCode,
    204,
  );
  assert.deepEqual(f.service.memories(), []);
});
test("memory persists through database reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "muse-memory-"));
  const c = { ...config, DATABASE_PATH: join(dir, "db.sqlite") };
  try {
    const a = await buildApp(c, { planner });
    a.service.saveMemory({ title: "Interest", text: "I like museums" });
    await a.app.close();
    const b = await buildApp(c, { planner });
    try {
      assert.equal(b.service.memories()[0].text, "I like museums");
    } finally {
      await b.app.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("editing memory cancels an in-flight turn so it cannot restore stale context", async (t) => {
  let started!: () => void;
  const ready = new Promise<void>((r) => (started = r));
  let finish!: () => void;
  const f = await buildApp(config, {
    planner: {
      transcribe: async () => "",
      plan: async () => {
        started();
        await new Promise<void>((r) => (finish = r));
        return { kind: "reply", text: "old fact" };
      },
    },
  });
  t.after(() => f.app.close());
  const s = f.service.createSession("UTC");
  const pending = f.service.turn(s.id, randomUUID(), { text: "where?" });
  await ready;
  f.service.saveMemory({ title: "Home", text: "Bristol" });
  finish();
  await assert.rejects(pending, (e: any) => e.code === "turn_cancelled");
  assert.deepEqual(f.service.session(s.id).messages, []);
});

test("renaming a memory cannot create conflicting duplicate titles", async (t) => {
  const f = await buildApp(config, { planner });
  t.after(() => f.app.close());
  f.service.saveMemory({ title: "Home city", text: "London" });
  const other = f.service.saveMemory({ title: "Other city", text: "Bristol" });
  assert.throws(
    () =>
      f.service.saveMemory({ title: "home city", text: "Bristol" }, other.id),
    (e: any) => e.code === "memory_title_conflict",
  );
  assert.equal(
    f.service.memories().find((m) => m.id === other.id)?.title,
    "Other city",
  );
});
