import { randomUUID } from "node:crypto";
import { AppError } from "./domain.ts";
import type { Store } from "./store.ts";

import {
  zone,
  reminderInputSchema,
  reminderUpdateSchema,
} from "./reminder-schema.ts";
export {
  reminderInputSchema,
  reminderUpdateSchema,
} from "./reminder-schema.ts";
export type Reminder = {
  id: string;
  title: string;
  dueAt: string;
  timeZone: string;
  status: "pending" | "completed";
  recurrence: "none" | "daily" | "weekly";
  createdAt: number;
  updatedAt: number;
  sourceCallId?: string;
  notifiedAt?: number;
  lastDueAt?: string;
};
export type ReminderOccurrence = {
  id: string;
  reminder: Reminder;
  dueAt: string;
  occurredAt: number;
  missedOccurrences: number;
};
type LocalTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};
type RecordValue = Reminder & {
  anchor: Pick<LocalTime, "hour" | "minute" | "second">;
  fingerprint: string;
};

export function localParts(at: number, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}
function wallNumber(parts: LocalTime) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}
// Resolve wall time with offsets around the transition. A fold picks its earlier
// occurrence; a gap shifts forward by the DST gap while retaining the recurrence anchor.
export function localInstant(parts: LocalTime, timeZone: string): number {
  const wall = wallNumber(parts);
  const offsets = new Set<number>();
  for (const delta of [-2, -1, 0, 1, 2]) {
    const sample = wall + delta * 86400000;
    offsets.add(wallNumber(localParts(sample, timeZone)) - sample);
  }
  const candidates = [...offsets].map((offset) => wall - offset);
  const exact = candidates.filter(
    (at) => wallNumber(localParts(at, timeZone)) === wall,
  );
  if (exact.length) return Math.min(...exact);
  const after = candidates
    .filter((at) => wallNumber(localParts(at, timeZone)) > wall)
    .sort(
      (a, b) =>
        wallNumber(localParts(a, timeZone)) -
          wallNumber(localParts(b, timeZone)) || a - b,
    );
  if (after.length) return after[0]!;
  throw new AppError(
    422,
    "invalid_local_time",
    "Choose another reminder time.",
  );
}
export function localDayWindow(now: number, timeZone: string) {
  zone.parse(timeZone);
  const today = localParts(now, timeZone);
  const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return {
    date: `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`,
    start: new Date(
      localInstant({ ...today, hour: 0, minute: 0, second: 0 }, timeZone),
    ).toISOString(),
    end: new Date(
      localInstant(
        {
          year: next.getUTCFullYear(),
          month: next.getUTCMonth() + 1,
          day: next.getUTCDate(),
          hour: 0,
          minute: 0,
          second: 0,
        },
        timeZone,
      ),
    ).toISOString(),
  };
}
function publicReminder(value: RecordValue): Reminder {
  const { anchor: _anchor, fingerprint: _fingerprint, ...result } = value;
  return result;
}
export class Reminders {
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  constructor(
    private store: Store,
    private onDue?: (occurrence: ReminderOccurrence) => void,
    private now: () => number = Date.now,
  ) {}
  list(): Reminder[] {
    return this.store
      .list<RecordValue>("reminder")
      .map((r) => publicReminder(r.value))
      .sort(
        (a, b) =>
          Number(a.status === "completed") - Number(b.status === "completed") ||
          Date.parse(a.dueAt) - Date.parse(b.dueAt) ||
          a.id.localeCompare(b.id),
      );
  }
  get(id: string): Reminder {
    return publicReminder(this.record(id));
  }
  private record(id: string): RecordValue {
    const value = this.store.get<RecordValue>("reminder", id);
    if (!value)
      throw new AppError(
        404,
        "reminder_not_found",
        "That reminder no longer exists.",
      );
    return value;
  }
  private future(value: string) {
    if (Date.parse(value) <= this.now())
      throw new AppError(
        422,
        "past_reminder",
        "Choose a future reminder time.",
      );
  }
  create(input: unknown): Reminder {
    const parsed = reminderInputSchema.parse(input),
      { id = randomUUID(), ...body } = parsed;
    const fingerprint = JSON.stringify(body),
      existing = this.store.get<RecordValue>("reminder", id);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new AppError(
          409,
          "reminder_conflict",
          "This reminder request has different details.",
        );
      return publicReminder(existing);
    }
    this.future(body.dueAt);
    if (this.store.list("reminder").length >= 500)
      throw new AppError(
        409,
        "reminder_limit",
        "Remove old reminders before adding another.",
      );
    if (body.sourceCallId && !this.store.get("call", body.sourceCallId))
      throw new AppError(
        404,
        "booking_not_found",
        "The linked booking no longer exists.",
      );
    const { hour, minute, second } = localParts(
        Date.parse(body.dueAt),
        body.timeZone,
      ),
      now = this.now();
    const value: RecordValue = {
      ...body,
      id,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      anchor: { hour, minute, second },
      fingerprint,
    };
    this.store.put("reminder", id, value);
    return publicReminder(value);
  }
  update(id: string, input: unknown): Reminder {
    const patch = reminderUpdateSchema.parse(input),
      value = this.record(id);
    if (patch.dueAt) this.future(patch.dueAt);
    if (
      patch.status === "pending" &&
      value.status === "completed" &&
      !patch.dueAt
    )
      this.future(value.dueAt);
    if (
      !patch.dueAt &&
      ((patch.recurrence && patch.recurrence !== value.recurrence) ||
        patch.timeZone)
    )
      this.future(value.dueAt);
    Object.assign(value, patch, { updatedAt: this.now() });
    if (patch.dueAt || patch.timeZone) {
      const { hour, minute, second } = localParts(
        Date.parse(value.dueAt),
        value.timeZone,
      );
      value.anchor = { hour, minute, second };
      delete value.notifiedAt;
      delete value.lastDueAt;
    }
    if (patch.dueAt && patch.status === undefined) value.status = "pending";
    this.store.put("reminder", id, value);
    return publicReminder(value);
  }
  remove(id: string) {
    this.store.delete("reminder", id);
  }
  private next(value: RecordValue, from: number) {
    const local = localParts(from, value.timeZone),
      date = new Date(
        Date.UTC(
          local.year,
          local.month - 1,
          local.day + (value.recurrence === "weekly" ? 7 : 1),
        ),
      );
    return localInstant(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        ...value.anchor,
      },
      value.timeZone,
    );
  }
  tick() {
    if (this.stopped) return;
    const now = this.now();
    let failure: unknown;
    for (const { id } of this.store.list<RecordValue>("reminder")) {
      try {
        this.store.transaction(() => {
          const value = this.record(id),
            due = Date.parse(value.dueAt);
          if (
            value.status !== "pending" ||
            due > now ||
            value.lastDueAt === value.dueAt
          )
            return;
          let next = due,
            missedOccurrences = 0;
          if (value.recurrence !== "none") {
            do {
              next = this.next(value, next);
              missedOccurrences++;
              if (missedOccurrences > 10000)
                throw new AppError(
                  422,
                  "reminder_too_old",
                  "Review this old recurring reminder.",
                );
            } while (next <= now);
          } else missedOccurrences = 1;
          const occurrence: ReminderOccurrence = {
            id: `${id}:${value.dueAt}`,
            reminder: publicReminder(value),
            dueAt: value.dueAt,
            occurredAt: now,
            missedOccurrences,
          };
          // Root callback only persists a notification outbox entry synchronously.
          // A callback failure rolls back the occurrence, so restart can retry it.
          this.onDue?.(occurrence);
          value.notifiedAt = now;
          value.lastDueAt = value.dueAt;
          value.updatedAt = now;
          if (value.recurrence !== "none")
            value.dueAt = new Date(next).toISOString();
          this.store.put("reminder", id, value);
        });
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  }
  start() {
    if (this.timer || this.stopped) return;
    const run = () => {
      try {
        this.tick();
      } catch {
        console.error(
          "Reminder scheduling failed; pending reminders will be retried.",
        );
      }
    };
    run();
    this.timer = setInterval(run, 15000);
    this.timer.unref();
  }
  close() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
