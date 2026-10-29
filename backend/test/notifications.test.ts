import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  Notifications,
  type PushTransport,
  type PushPayload,
} from "../src/notifications.ts";
import { readConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { buildApp } from "../src/app.ts";
import type { CallAction, PublicCallAction } from "../src/calls.ts";
process.env.NODE_ENV = "test";
const privateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const config = (live = true) =>
  readConfig({
    API_TOKEN: "a".repeat(64),
    ENCRYPTION_KEY: "b".repeat(64),
    DATABASE_PATH: ":memory:",
    APP_MODE: live ? "live" : "mock",
    MODEL_API_KEY: live ? "test" : "",
    APNS_TEAM_ID: "TEAM123456",
    APNS_KEY_ID: "KEY1234567",
    APNS_PRIVATE_KEY: privateKey,
  });
const device = () => ({
  id: randomUUID(),
  token: "ab".repeat(32),
  platform: "ios" as const,
  environment: "sandbox" as const,
});
const call = (sessionId = randomUUID()): PublicCallAction => ({
  id: randomUUID(),
  sessionId,
  booking: {
    destinationName: "Private salon",
    phoneNumber: "+447700900123",
    purpose: "Private appointment",
    customerName: "Private name",
    timeZone: "Europe/London",
    window: { start: "2026-11-02T12:00:00Z", end: "2026-11-02T16:00:00Z" },
    durationMinutes: 30,
  },
  status: "completed",
  outcome: "booked",
  finishedAt: Date.now(),
  expiresAt: Date.now() + 600000,
  calendarChecked: true,
  slots: [],
  turn: 1,
});
function fixture(transport: PushTransport) {
  const store = new Store(":memory:", "b".repeat(64));
  return {
    store,
    notifications: new Notifications(config(), store, transport),
  };
}
test("APNs opt-in is validated, private, idempotent, and environment-specific", async (t) => {
  const f = fixture(async () => ({ status: 200 }));
  t.after(async () => {
    await f.notifications.close();
    f.store.close();
  });
  assert.equal(f.notifications.configured(), true);
  const d = device();
  f.notifications.register(d);
  f.notifications.register(d);
  assert.equal(f.store.list("push-device").length, 1);
  assert.throws(() => f.notifications.register({ ...d, token: "bad" }));
  assert.throws(() =>
    f.notifications.register({ ...d, environment: "production" }),
  );
  assert.equal(new Notifications(config(false), f.store).configured(), false);
  assert.equal(
    new Notifications(
      { ...config(), APNS_PRIVATE_KEY: "bad key" },
      f.store,
    ).configured(),
    false,
  );
});
test("terminal task sends once across repeat saves, concurrent drains and restart, with private payload", async (t) => {
  const payloads: PushPayload[] = [];
  const send: PushTransport = async (_device, payload) => {
    payloads.push(payload);
    return { status: 200 };
  };
  const f = fixture(send);
  t.after(() => f.store.close());
  f.notifications.register(device());
  const c = call();
  f.notifications.enqueue({ ...c, status: "in_progress" });
  await f.notifications.flush();
  assert.equal(payloads.length, 0);
  f.notifications.enqueue(c);
  f.notifications.enqueue(c);
  await Promise.all([f.notifications.flush(), f.notifications.flush()]);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].taskId, c.id);
  assert.doesNotMatch(JSON.stringify(payloads[0]), /Private|447700/);
  await f.notifications.close();
  const restarted = new Notifications(config(), f.store, send);
  restarted.enqueue(c);
  await restarted.flush();
  assert.equal(payloads.length, 1);
  await restarted.close();
});
test("APNs transient failures retry durably; invalid tokens are removed; opt-out clears queued alerts", async (t) => {
  let attempts = 0;
  const f = fixture(async () => ({ status: ++attempts === 1 ? 503 : 200 }));
  t.after(async () => {
    await f.notifications.close();
    f.store.close();
  });
  const d = device();
  f.notifications.register(d);
  f.notifications.enqueue(call());
  await f.notifications.flush();
  const row = f.store.list<any>("push-delivery")[0];
  assert.equal(row.value.status, "pending");
  assert.equal(row.value.attempts, 1);
  await f.notifications.flush();
  assert.equal(attempts, 1);
  f.store.put("push-delivery", row.id, { ...row.value, nextAttemptAt: 0 });
  await f.notifications.flush();
  assert.equal(attempts, 2);
  assert.equal(f.store.get<any>("push-delivery", row.id).status, "accepted");
  f.notifications.enqueue(call());
  f.notifications.remove(d.id);
  await f.notifications.flush();
  assert.equal(attempts, 2);
  assert.equal(f.store.list("push-delivery").length, 0);
  const invalid = new Notifications(config(), f.store, async () => ({
    status: 410,
    reason: "Unregistered",
  }));
  invalid.register(d);
  invalid.enqueue(call());
  await invalid.flush();
  assert.equal(f.store.list("push-device").length, 0);
  await invalid.close();
});
test("expired alerts and permanently failing deliveries do not retry forever", async (t) => {
  let attempts = 0;
  const f = fixture(async () => {
    attempts++;
    return { status: 503 };
  });
  t.after(async () => {
    await f.notifications.close();
    f.store.close();
  });
  f.notifications.register(device());
  f.notifications.enqueue(call());
  const row = f.store.list<any>("push-delivery")[0];
  f.store.put("push-delivery", row.id, {
    ...row.value,
    attempts: 5,
    nextAttemptAt: 0,
  });
  await f.notifications.flush();
  assert.equal(f.store.get<any>("push-delivery", row.id).status, "failed");
  await f.notifications.flush();
  assert.equal(attempts, 1);
  f.notifications.enqueue(call());
  const old = f.store
    .list<any>("push-delivery")
    .find((r) => r.value.status === "pending")!;
  f.store.put("push-delivery", old.id, {
    ...old.value,
    createdAt: Date.now() - 2 * 86400000,
  });
  await f.notifications.flush();
  assert.equal(attempts, 1);
});
test("task feed spans sessions only behind account authentication; decisions keep original session binding", async (t) => {
  const f = await buildApp(config(false));
  t.after(() => f.app.close());
  const headers = { authorization: "Bearer " + "a".repeat(64) };
  const one = f.service.createSession("Europe/London"),
    two = f.service.createSession("Europe/London");
  const a = call(one.id),
    b = call(two.id);
  f.store.put("call", a.id, a);
  f.store.put("call", b.id, b);
  assert.equal((await f.app.inject("/v1/tasks")).statusCode, 401);
  const response = await f.app.inject({ url: "/v1/tasks", headers });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    new Set(response.json().calls.map((c: CallAction) => c.sessionId)),
    new Set([one.id, two.id]),
  );
  assert.equal(
    (
      await f.app.inject({
        url: `/v1/sessions/${one.id}/calls/${b.id}`,
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: `/v1/sessions/${one.id}/calls/${b.id}/change`,
        headers,
        payload: { operation: "cancel_booking" },
      })
    ).statusCode,
    404,
  );
  const d = device();
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/v1/notifications/devices",
        payload: d,
      })
    ).statusCode,
    401,
  );
  const registered = await f.app.inject({
    method: "POST",
    url: "/v1/notifications/devices",
    headers,
    payload: d,
  });
  assert.equal(registered.statusCode, 200);
  assert.equal(registered.json().configured, false);
  assert.equal(registered.json().token, undefined);
  assert.equal(
    (await f.app.inject({ url: "/v1/notifications/status", headers })).json()
      .configured,
    false,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/v1/notifications/devices/${d.id}`,
        headers,
      })
    ).statusCode,
    204,
  );
});

test("notification readiness is platform-specific and old outcomes are not replayed to new devices", async (t) => {
  let sent = 0;
  const f = fixture(async () => {
    sent++;
    return { status: 200 };
  });
  t.after(async () => {
    await f.notifications.close();
    f.store.close();
  });
  const d = device();
  f.notifications.register(d);
  f.notifications.enqueue({ ...call(), finishedAt: Date.now() - 10000 });
  await f.notifications.flush();
  assert.equal(sent, 0);
  const partial = new Notifications(
    { ...config(), APNS_TOPIC_WATCHOS: "" },
    f.store,
  );
  assert.equal(partial.configured("ios"), true);
  assert.equal(
    partial.register({ ...device(), platform: "watchos" }).configured,
    false,
  );
  await partial.close();
});

test("reminder alerts persist once per occurrence and keep private titles off lock screen", async (t) => {
  const { Reminders } = await import("../src/reminders.ts");
  const payloads: PushPayload[] = [];
  const f = fixture(async (_device, payload) => {
    payloads.push(payload);
    return { status: 200 };
  });
  t.after(async () => {
    await f.notifications.close();
    f.store.close();
  });
  f.notifications.register(device());
  let now = Date.now();
  const reminders = new Reminders(
    f.store,
    (occurrence) => {
      f.notifications.enqueueReminder(occurrence);
      f.notifications.enqueueReminder(occurrence);
    },
    () => now,
  );
  const reminder = reminders.create({
    title: "Private medical appointment",
    dueAt: new Date(now + 60000).toISOString(),
    timeZone: "UTC",
  });
  now += 60001;
  reminders.tick();
  reminders.tick();
  assert.equal(f.store.list("push-delivery").length, 1);
  await f.notifications.flush();
  await f.notifications.flush();
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0]?.reminderId, reminder.id);
  assert.equal(payloads[0]?.aps.alert.title, "Mochi has a reminder");
  assert.equal(JSON.stringify(payloads).includes("medical"), false);
});

test("completed, snoozed and deleted reminders suppress queued alerts", async (t) => {
  const { Reminders } = await import("../src/reminders.ts");
  const payloads: PushPayload[] = [];
  const f = fixture(async (_device, payload) => {
    payloads.push(payload);
    return { status: 200 };
  });
  t.after(async () => {
    await f.notifications.close();
    f.store.close();
  });
  f.notifications.register(device());
  let now = Date.now();
  const reminders = new Reminders(
    f.store,
    (occurrence) => f.notifications.enqueueReminder(occurrence),
    () => now,
  );
  const ids = Array.from(
    { length: 3 },
    () =>
      reminders.create({
        title: "Review booking",
        dueAt: new Date(now + 60000).toISOString(),
        timeZone: "UTC",
        recurrence: "daily",
      }).id,
  );
  now += 60001;
  reminders.tick();
  assert.equal(f.store.list("push-delivery").length, 3);
  reminders.update(ids[0]!, { status: "completed" });
  reminders.update(ids[1]!, { dueAt: new Date(now + 60000).toISOString() });
  reminders.remove(ids[2]!);
  await f.notifications.flush();
  assert.equal(payloads.length, 0);
  assert.equal(f.store.list("push-delivery").length, 0);
});
