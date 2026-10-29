import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import type { Planner, Plan } from "../src/domain.ts";
import { AppError } from "../src/domain.ts";
process.env.NODE_ENV = "test";
const config = readConfig({
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  DATABASE_PATH: ":memory:",
});
const headers = { authorization: `Bearer ${config.API_TOKEN}` };
test("Gmail drafts initializes in a fresh module graph without importing domain first", async () => {
  const moduleURL = new URL("../src/gmail-drafts.ts", import.meta.url).href;
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    import.meta.resolve("tsx"),
    "--input-type=module",
    "-e",
    `const module = await import(${JSON.stringify(moduleURL)}); if (typeof module.GmailDrafts !== "function") throw new Error("missing draft service"); console.log("ready");`,
  ]);
  assert.equal(stdout.trim(), "ready");
});

test("session deletion is blocked during draft confirmation and preserves an uncertain save", async (t) => {
  const f = await buildApp({
    ...config,
    APP_MODE: "live",
    MODEL_API_KEY: "test",
  });
  t.after(() => f.app.close());
  f.store.put("secret", "gmail", {
    access: "fixture-access",
    expiresAt: Date.now() + 3600000,
    epoch: "fixture-account",
    draftsEnabled: true,
    scopes: ["https://www.googleapis.com/auth/gmail.compose"],
  });
  const session = f.service.createSession("UTC");
  const draft = f.drafts.prepare(session.id, {
    to: "recipient@example.com",
    subject: "Review only",
    body: "Fixture draft, not a real email.",
  });
  let releaseProfile!: () => void;
  let profileStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseProfile = resolve;
  });
  const started = new Promise<void>((resolve) => {
    profileStarted = resolve;
  });
  let writes = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/profile")) {
        profileStarted();
        await gate;
        return Response.json({ emailAddress: "owner@example.com" });
      }
      assert.equal(init?.method, "POST");
      assert(String(url).endsWith("/drafts"));
      writes++;
      return new Response("unavailable", { status: 503 });
    },
  );
  const decision = assert.rejects(
    f.service.decideDraft(session.id, draft.id, "confirm"),
  );
  await started;
  try {
    await assert.rejects(
      f.service.deleteSession(session.id),
      (error: unknown) => error instanceof AppError && error.code === "busy",
    );
    assert.equal(f.service.session(session.id).id, session.id);
  } finally {
    releaseProfile();
  }
  await decision;
  await assert.rejects(
    f.service.deleteSession(session.id),
    (error: unknown) =>
      error instanceof AppError && error.code === "draft_save_uncertain",
  );
  assert.equal(writes, 1);
  assert.equal(f.drafts.get(session.id, draft.id).status, "uncertain");
  assert.equal(f.service.session(session.id).id, session.id);
});
test("shared reminders enforce auth, stable creation, snooze and completion; briefing honors disabled Calendar", async (t) => {
  const f = await buildApp(config);
  t.after(() => f.app.close());
  const request = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: any,
  ) => f.app.inject({ method, url, headers, payload });
  assert.equal((await f.app.inject("/v1/reminders")).statusCode, 401);
  const input = {
    id: randomUUID(),
    title: "Leave for haircut",
    dueAt: new Date(Date.now() + 3600000).toISOString(),
    timeZone: "Europe/London",
  };
  const first = await request("POST", "/v1/reminders", input);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(
    (await request("POST", "/v1/reminders", input)).json().reminder.id,
    input.id,
  );
  assert.equal(
    (await request("POST", "/v1/reminders", { ...input, title: "Different" }))
      .statusCode,
    409,
  );
  assert.equal(
    (await request("GET", "/v1/reminders")).json().reminders.length,
    1,
  );
  f.store.put("integration", "calendar-enabled", false);
  const daily = (
    await request("GET", "/v1/briefing?timeZone=Europe%2FLondon")
  ).json();
  assert.equal(daily.sources.calendar, "disabled");
  assert.match(daily.summary, /switched off/);
  assert.equal(daily.simulated, true);
  assert.equal(
    (await request("GET", "/v1/briefing?timeZone=Invalid")).statusCode,
    400,
  );
  const snooze = new Date(Date.now() + 7200000).toISOString();
  assert.equal(
    (
      await request("PATCH", `/v1/reminders/${input.id}`, { dueAt: snooze })
    ).json().reminder.dueAt,
    snooze,
  );
  assert.equal(
    (
      await request("PATCH", `/v1/reminders/${input.id}`, {
        status: "completed",
      })
    ).json().reminder.status,
    "completed",
  );
  assert.equal(
    (await request("DELETE", `/v1/reminders/${input.id}`)).statusCode,
    204,
  );
  assert.equal(
    (await request("GET", "/v1/reminders")).json().reminders.length,
    0,
  );
});
test("voice reminder retries are idempotent and overview has no booking or mail side effects", async (t) => {
  let plan: Plan = {
    kind: "create_reminder",
    reminder: {
      title: "Haircut follow-up",
      dueAt: new Date(Date.now() + 3600000).toISOString(),
      timeZone: "UTC",
      recurrence: "none",
    },
  };
  let supplied: any;
  const planner: Planner = {
    transcribe: async () => "",
    plan: async (_m, _z, options) => {
      supplied = options?.reminders;
      return plan;
    },
  };
  const f = await buildApp(config, { planner });
  t.after(() => f.app.close());
  const session = f.service.createSession("UTC");
  const key = randomUUID();
  const first = await f.service.turn(session.id, key, {
    text: "Remind me in an hour",
  });
  assert.equal(first.state, "happy");
  await f.service.turn(session.id, key, { text: "Remind me in an hour" });
  assert.equal(f.reminders.list().length, 1);
  plan = { kind: "daily_briefing" };
  const briefing = await f.service.turn(session.id, randomUUID(), {
    text: "Brief me on today",
  });
  assert.match(briefing.speechText, /Calendar/);
  assert.equal(supplied.length, 1);
  assert.equal(f.calls.listAll().length, 0);
  assert.equal(f.drafts.list().length, 0);
  const response = await f.app.inject({
    method: "POST",
    url: `/v1/sessions/${session.id}/drafts`,
    headers,
    payload: {
      to: "salon@example.com",
      subject: "Haircut",
      body: "Please confirm availability",
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(f.drafts.list().length, 0);
});
