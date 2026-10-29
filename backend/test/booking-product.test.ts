import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BookingProfiles } from "../src/booking-profile.ts";
import { BookingSupport } from "../src/booking-support.ts";
import { Calls, type CallAction } from "../src/calls.ts";
import { Reminders } from "../src/reminders.ts";
import { Store } from "../src/store.ts";
import { readConfig } from "../src/config.ts";
import type { Calendar } from "../src/domain.ts";
const config = readConfig({
  APP_MODE: "live",
  MODEL_API_KEY: "test",
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  DATABASE_PATH: ":memory:",
  ELEVENLABS_API_KEY: "test",
  TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
  TWILIO_AUTH_TOKEN: "test",
  TWILIO_FROM_NUMBER: "+442012345678",
  TWILIO_ALLOWED_NUMBERS: "+442012345679",
  CALLS_PUBLIC_URL: "https://example.com",
  DAILY_CALL_LIMIT: "1",
});
const profile = {
  destinationName: "My private barber",
  phoneNumber: "+442012345679",
  purpose: "Haircut",
  customerName: "Alex",
  durationMinutes: 30,
  timeZone: "Europe/London",
  preferredDays: [5, 1, 3],
  preferredStart: "14:00",
  preferredEnd: "18:00",
};
const window = { start: "2030-11-05T14:00:00Z", end: "2030-11-05T16:00:00Z" };
const booking = {
  destinationName: profile.destinationName,
  phoneNumber: profile.phoneNumber,
  purpose: profile.purpose,
  customerName: profile.customerName,
  durationMinutes: 30,
  timeZone: profile.timeZone,
  window,
};
const calendar: Calendar = {
  busy: async () => [],
  list: async () => [],
  create: async () => {
    throw new Error("Calendar writes forbidden");
  },
};
function fixture(t: any) {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  const calls = new Calls(config, store, calendar, () => false);
  const reminders = new Reminders(store);
  t.after(async () => {
    await calls.close();
    reminders.close();
    store.close();
  });
  return { store, calls, reminders };
}
function seed(store: Store, extra: Partial<CallAction> = {}): CallAction {
  const call: CallAction = {
    id: randomUUID(),
    sessionId: randomUUID(),
    booking,
    status: "failed",
    endReason: "no-answer",
    expiresAt: Date.now() + 600000,
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    calendarChecked: false,
    slots: [],
    turn: 0,
    ...extra,
  };
  store.put("call", call.id, call);
  return call;
}

test("booking profile persists encrypted explicit preferences and rejects ambiguous windows", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "jolly-profile-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "profile.sqlite");
  let store = new Store(path, config.ENCRYPTION_KEY);
  let profiles = new BookingProfiles(store);
  assert.equal(profiles.get(), null);
  const saved = profiles.save(profile);
  assert.deepEqual(saved.preferredDays, [1, 3, 5]);
  assert.equal("window" in saved, false);
  for (const invalid of [
    { preferredDays: [] },
    { preferredDays: [1, 1] },
    { preferredDays: [0] },
    { preferredStart: "18:00", preferredEnd: "09:00" },
    { durationMinutes: 240, preferredEnd: "15:00" },
    { phoneNumber: "02012345679" },
    { timeZone: "unknown" },
  ])
    assert.throws(() => profiles.save({ ...profile, ...invalid }));
  store.close();
  assert.equal(
    readFileSync(path).includes(Buffer.from(profile.destinationName)),
    false,
  );
  store = new Store(path, config.ENCRYPTION_KEY);
  profiles = new BookingProfiles(store);
  assert.equal(profiles.get()?.phoneNumber, profile.phoneNumber);
  profiles.remove();
  assert.equal(profiles.get(), null);
  store.close();
});
test("retry prepares one new approval with calendar reads but never dials; different retries conflict", async (t) => {
  const f = fixture(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No provider requests during preparation");
  });
  const source = seed(f.store);
  const first = await f.calls.prepareRetry(source.sessionId, source.id, {
    window,
  });
  assert.equal(first.callAction?.status, "pending");
  assert.equal(first.callAction?.retryOfCallId, source.id);
  assert.equal(first.callAction?.callSid, undefined);
  const again = await f.calls.prepareRetry(source.sessionId, source.id, {
    window,
  });
  assert.equal(again.callAction?.id, first.callAction?.id);
  assert.equal(
    f.calls.publicAction(f.calls.get(source.sessionId, source.id)).followUp
      ?.canRetry,
    false,
  );
  await assert.rejects(
    f.calls.prepareRetry(source.sessionId, source.id, {
      window: { start: "2030-11-06T14:00:00Z", end: "2030-11-06T16:00:00Z" },
    }),
    /later attempt/,
  );
  await assert.rejects(
    f.calls.prepareRetry(randomUUID(), source.id, { window }),
    /not found/,
  );
  await f.calls.decide(source.sessionId, first.callAction!.id, "cancel");
  const fresh = await f.calls.prepareRetry(source.sessionId, source.id, {
    window,
  });
  assert.notEqual(fresh.callAction?.id, first.callAction?.id);
});
test("unverified, confirmed, stopped and payment-handoff calls never become retry proposals", async (t) => {
  const f = fixture(t);
  for (const extra of [
    { status: "uncertain" },
    { status: "completed", outcome: "booked", bookedSlot: window },
    {
      status: "failed",
      failure: { stage: "outcome", category: "invalid_response" },
    },
    { status: "completed", outcome: "not_booked", endReason: "silence" },
    {
      status: "completed",
      outcome: "not_booked",
      endReason: "payment_required",
    },
    { status: "stopped" },
    {
      status: "completed",
      outcome: "not_booked",
      endReason: "not_booked",
      operation: "reschedule",
    },
  ] as Partial<CallAction>[]) {
    const source = seed(f.store, { endReason: undefined, ...extra });
    await assert.rejects(
      f.calls.prepareRetry(source.sessionId, source.id, { window }),
      /outcome/,
    );
    assert.equal(f.calls.publicAction(source).followUp?.canRetry, false);
    f.store.delete("call", source.id);
  }
  const source = seed(f.store, {
    status: "completed",
    outcome: "not_booked",
    endReason: "not_booked",
  });
  assert.equal(f.calls.publicAction(source).followUp?.canRetry, true);
  seed(f.store, { status: "uncertain" });
  await assert.rejects(
    f.calls.prepareRetry(source.sessionId, source.id, { window }),
    /active or unverified/,
  );
});
test("booking reminder uses explicit before-appointment time and stable ID; superseded booking rejected", (t) => {
  const f = fixture(t);
  const support = new BookingSupport(f.calls, f.reminders);
  const source = seed(f.store, {
    status: "completed",
    outcome: "booked",
    bookedSlot: { start: window.start, end: "2030-11-05T14:30:00Z" },
  });
  const body = {
    id: randomUUID(),
    dueAt: "2030-11-05T13:00:00Z",
    timeZone: "Europe/London",
  };
  const reminder = support.remind(source.sessionId, source.id, body);
  assert.equal(reminder.sourceCallId, source.id);
  assert.equal(
    support.remind(source.sessionId, source.id, body).id,
    reminder.id,
  );
  assert.equal(f.reminders.list().length, 1);
  assert.throws(
    () =>
      support.remind(source.sessionId, source.id, {
        ...body,
        id: randomUUID(),
        dueAt: window.start,
      }),
    /before/,
  );
  f.store.put("call", source.id, { ...source, supersededBy: randomUUID() });
  assert.throws(
    () => support.remind(source.sessionId, source.id, body),
    /current confirmed/,
  );
});
test("verified cancellation completes obsolete booking reminders", (t) => {
  const f = fixture(t);
  const source = seed(f.store, {
    status: "completed",
    outcome: "booked",
    bookedSlot: { start: window.start, end: "2030-11-05T14:30:00Z" },
  });
  const reminder = f.reminders.create({
    title: "Appointment",
    dueAt: "2030-11-05T13:00:00Z",
    timeZone: "UTC",
    sourceCallId: source.id,
  });
  const sid = "CA" + "c".repeat(32);
  const change = seed(f.store, {
    sessionId: source.sessionId,
    status: "in_progress",
    operation: "cancel_booking",
    sourceCallId: source.id,
    decision: "confirm",
    callSid: sid,
    turn: 1,
  });
  f.store.put("call-turn", `${change.id}:1`, {
    status: "ready",
    createdAt: Date.now(),
    speech: "Confirmed cancelled",
    finish: true,
    outcome: "booking_cancelled",
    audioToken: "test",
  });
  f.calls.voice(change.id, 1, { CallSid: sid });
  assert.equal(f.reminders.get(reminder.id).status, "completed");
  assert.equal(
    f.calls.get(source.sessionId, source.id).supersededBy,
    change.id,
  );
});
test("daily call budget survives history deletion and blocks new dial attempts", async (t) => {
  const f = fixture(t);
  let dials = 0;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url).includes("elevenlabs"))
      return new Response(Buffer.from("audio"), {
        headers: { "content-type": "audio/mpeg" },
      });
    dials++;
    return Response.json({ sid: "CA" + "c".repeat(32) });
  });
  const session = randomUUID();
  const first = await f.calls.prepare(session, booking);
  await f.calls.decide(session, first.callAction!.id, "confirm");
  assert.equal(dials, 1);
  assert.equal(f.calls.dailyUsage().attempts, 1);
  const call = f.calls.get(session, first.callAction!.id);
  f.store.put("call", call.id, {
    ...call,
    status: "failed",
    endReason: "no-answer",
  });
  f.calls.deleteSession(session);
  assert.equal(f.calls.dailyUsage().attempts, 1);
  const next = await f.calls.prepare(randomUUID(), booking);
  await assert.rejects(
    f.calls.decide(next.sessionId, next.callAction!.id, "confirm"),
    /daily call limit/,
  );
  assert.equal(dials, 1);
  assert.equal(
    f.calls.get(next.sessionId, next.callAction!.id).status,
    "pending",
  );
});

test("legacy attempts seed the durable daily budget without double counting", async (t) => {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  const source = seed(store);
  let calls = new Calls(config, store, calendar, () => false);
  assert.equal(calls.dailyUsage().attempts, 1);
  await calls.close();
  calls = new Calls(config, store, calendar, () => false);
  assert.equal(calls.dailyUsage().attempts, 1);
  calls.deleteSession(source.sessionId);
  assert.equal(calls.dailyUsage().attempts, 1);
  await calls.close();
  store.close();
});

test("concurrent retry preparation cannot produce two proposals", async (t) => {
  const f = fixture(t);
  const source = seed(f.store);
  const results = await Promise.allSettled([
    f.calls.prepareRetry(source.sessionId, source.id, { window }),
    f.calls.prepareRetry(source.sessionId, source.id, { window }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    f.calls.listAll().filter((call) => call.retryOfCallId === source.id).length,
    1,
  );
});
