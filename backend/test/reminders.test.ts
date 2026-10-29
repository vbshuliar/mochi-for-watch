import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "../src/store.ts";
import {
  Reminders,
  localDayWindow,
  type ReminderOccurrence,
} from "../src/reminders.ts";
const setup = (
  t: any,
  at = "2030-03-30T09:00:00Z",
  callback?: (event: ReminderOccurrence, store: Store) => void,
) => {
  const store = new Store(":memory:", "b".repeat(64));
  let now = Date.parse(at);
  const delivered: ReminderOccurrence[] = [];
  const reminders = new Reminders(
    store,
    (event) => {
      callback?.(event, store);
      delivered.push(event);
    },
    () => now,
  );
  t.after(() => {
    reminders.close();
    store.close();
  });
  return {
    store,
    reminders,
    delivered,
    clock: (at: string) => {
      now = Date.parse(at);
    },
    now: () => now,
  };
};
test("reminders validate and persist idempotently without provider actions", (t) => {
  const f = setup(t);
  const id = randomUUID(),
    input = {
      id,
      title: "Book my haircut",
      dueAt: "2030-03-30T10:00:00Z",
      timeZone: "Europe/London",
    };
  const first = f.reminders.create(input);
  assert.equal(first.recurrence, "none");
  assert.deepEqual(f.reminders.create(input), first);
  assert.equal(f.reminders.list().length, 1);
  assert.throws(
    () => f.reminders.create({ ...input, title: "Different" }),
    /different details/,
  );
  assert.throws(
    () =>
      f.reminders.create({
        ...input,
        id: randomUUID(),
        dueAt: "2030-03-30T08:00:00Z",
      }),
    /future/,
  );
  assert.throws(() =>
    f.reminders.create({ ...input, id: randomUUID(), timeZone: "Invalid" }),
  );
  assert.throws(
    () =>
      f.reminders.create({
        ...input,
        id: randomUUID(),
        sourceCallId: randomUUID(),
      }),
    /booking/,
  );
  assert.equal(f.delivered.length, 0);
  assert.equal(Object.hasOwn(first, "fingerprint"), false);
});
test("due notification survives restart exactly once and one-off reminder remains actionable", (t) => {
  const f = setup(t);
  const item = f.reminders.create({
    title: "Check haircut booking",
    dueAt: "2030-03-30T10:00:00Z",
    timeZone: "Europe/London",
  });
  f.reminders.tick();
  assert.equal(f.delivered.length, 0);
  f.clock("2030-03-30T10:01:00Z");
  f.reminders.tick();
  f.reminders.tick();
  assert.equal(f.delivered.length, 1);
  assert.equal(f.reminders.get(item.id).status, "pending");
  assert.equal(f.reminders.get(item.id).notifiedAt, f.now());
  const restarted = new Reminders(f.store, (e) => f.delivered.push(e), f.now);
  restarted.tick();
  assert.equal(f.delivered.length, 1);
  restarted.close();
  f.reminders.update(item.id, { status: "completed" });
  assert.equal(f.reminders.get(item.id).status, "completed");
  assert.throws(
    () => f.reminders.update(item.id, { status: "pending" }),
    /future/,
  );
  f.reminders.update(item.id, { dueAt: "2030-03-30T11:00:00Z" });
  assert.equal(f.reminders.get(item.id).status, "pending");
  f.clock("2030-03-30T11:01:00Z");
  f.reminders.tick();
  assert.equal(f.delivered.length, 2);
  assert.notEqual(f.delivered[0].id, f.delivered[1].id);
  f.reminders.remove(item.id);
  assert.deepEqual(f.reminders.list(), []);
  f.reminders.remove(item.id);
});
test("callback queue failure rolls back delivery evidence and retries", (t) => {
  let fail = true;
  const f = setup(t, undefined, (e, store) => {
    store.put("test-outbox", e.id, e);
    if (fail) throw new Error("disk unavailable");
  });
  f.reminders.create({
    title: "Call barber",
    dueAt: "2030-03-30T10:00:00Z",
    timeZone: "Europe/London",
  });
  f.clock("2030-03-30T10:01:00Z");
  assert.throws(() => f.reminders.tick());
  assert.equal(f.store.list("test-outbox").length, 0);
  assert.equal(f.reminders.list()[0].notifiedAt, undefined);
  fail = false;
  f.reminders.tick();
  assert.equal(f.store.list("test-outbox").length, 1);
  assert.equal(f.delivered.length, 1);
});
test("daily recurrence preserves local clock over DST and aggregates missed occurrences", (t) => {
  const f = setup(t);
  const r = f.reminders.create({
    title: "Check bookings",
    dueAt: "2030-03-30T10:00:00Z",
    timeZone: "Europe/London",
    recurrence: "daily",
  });
  f.clock("2030-03-30T10:01:00Z");
  f.reminders.tick();
  assert.equal(f.reminders.get(r.id).dueAt, "2030-03-31T09:00:00.000Z");
  f.clock("2030-04-03T11:00:00Z");
  f.reminders.tick();
  assert.equal(f.delivered.length, 2);
  assert.equal(f.delivered[1].missedOccurrences, 4);
  assert.equal(f.reminders.get(r.id).dueAt, "2030-04-04T09:00:00.000Z");
  f.reminders.tick();
  assert.equal(f.delivered.length, 2);
});
test("nonexistent and folded local times have stable recurrence anchors", (t) => {
  const f = setup(t, "2030-03-29T00:00:00Z");
  const r = f.reminders.create({
    title: "Daily check",
    dueAt: "2030-03-30T01:30:00Z",
    timeZone: "Europe/London",
    recurrence: "daily",
  });
  f.clock("2030-03-30T02:00:00Z");
  f.reminders.tick();
  assert.equal(f.reminders.get(r.id).dueAt, "2030-03-31T01:30:00.000Z");
  f.clock("2030-03-31T02:00:00Z");
  f.reminders.tick();
  assert.equal(f.reminders.get(r.id).dueAt, "2030-04-01T00:30:00.000Z");
  const weekly = f.reminders.create({
    title: "Weekly check",
    dueAt: "2030-10-20T00:30:00Z",
    timeZone: "Europe/London",
    recurrence: "weekly",
  });
  f.clock("2030-10-20T01:00:00Z");
  f.reminders.tick();
  assert.equal(f.reminders.get(weekly.id).dueAt, "2030-10-27T00:30:00.000Z");
});
test("local day windows honor 23 and 25 hour DST days", () => {
  const spring = localDayWindow(
    Date.parse("2030-03-31T12:00:00Z"),
    "Europe/London",
  );
  assert.equal(Date.parse(spring.end) - Date.parse(spring.start), 23 * 3600000);
  const autumn = localDayWindow(
    Date.parse("2030-10-27T12:00:00Z"),
    "Europe/London",
  );
  assert.equal(Date.parse(autumn.end) - Date.parse(autumn.start), 25 * 3600000);
  assert.equal(
    localDayWindow(Date.parse("2030-03-31T23:00:00Z"), "Asia/Tokyo").date,
    "2030-04-01",
  );
});

test("one failed due callback does not block other reminders or lose its retry", (t) => {
  let failing = true;
  const f = setup(t, "2030-03-30T09:00:00Z", (event) => {
    if (failing && event.reminder.title === "Fail once")
      throw new Error("Outbox unavailable");
  });
  const a = f.reminders.create({
    title: "Fail once",
    dueAt: "2030-03-30T10:00:00Z",
    timeZone: "UTC",
  });
  f.reminders.create({
    title: "Other",
    dueAt: "2030-03-30T10:00:00Z",
    timeZone: "UTC",
  });
  f.clock("2030-03-30T11:00:00Z");
  assert.throws(() => f.reminders.tick());
  assert.equal(f.delivered.length, 1);
  assert.equal(f.reminders.get(a.id).notifiedAt, undefined);
  failing = false;
  f.reminders.tick();
  assert.equal(f.delivered.length, 2);
  assert.throws(() => f.reminders.update(a.id, { recurrence: "daily" }));
  assert.throws(() => f.reminders.update(a.id, { timeZone: "Europe/London" }));
  const next = "2030-03-31T10:00:00.000Z";
  f.reminders.update(a.id, { recurrence: "daily", dueAt: next });
  assert.equal(f.reminders.get(a.id).dueAt, next);
});
