import type { Calendar, Receipt } from "./domain.ts";
import type { PublicCallAction } from "./calls.ts";
import type { Mail } from "./workflows.ts";
import { Reminders, localDayWindow, type Reminder } from "./reminders.ts";

export type BriefingSourceStatus =
  "available" | "disabled" | "disconnected" | "unavailable" | "simulated";
export type DailyBriefing = {
  date: string;
  timeZone: string;
  generatedAt: number;
  summary: string;
  simulated: boolean;
  sources: {
    calendar: BriefingSourceStatus;
    gmail: BriefingSourceStatus;
    bookings: BriefingSourceStatus;
    reminders: BriefingSourceStatus;
  };
  events: Receipt[];
  calls: PublicCallAction[];
  reminders: Reminder[];
  emails: Array<Pick<Mail, "id" | "subject" | "from" | "date">>;
};
type Options = {
  calendar: Pick<Calendar, "list">;
  calls: { listAll(): PublicCallAction[] };
  reminders: Pick<Reminders, "list">;
  mail?: (query: string, signal?: AbortSignal) => Promise<Mail[]>;
  calendarStatus: () => "connected" | "disabled" | "disconnected" | "simulated";
  gmailStatus: () => "connected" | "disconnected" | "simulated";
  simulated: boolean;
  now?: () => number;
};
const active = new Set([
  "pending",
  "starting",
  "queued",
  "in_progress",
  "uncertain",
]);
const briefText = (value: string) =>
  value
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 100);
export class Briefing {
  constructor(private options: Options) {}
  async get(timeZone: string, signal?: AbortSignal): Promise<DailyBriefing> {
    signal?.throwIfAborted();
    const now = (this.options.now ?? Date.now)(),
      day = localDayWindow(now, timeZone);
    const calendarState = this.options.calendarStatus(),
      gmailState = this.options.gmailStatus();
    const result: DailyBriefing = {
      date: day.date,
      timeZone,
      generatedAt: now,
      summary: "",
      simulated: this.options.simulated,
      sources: {
        calendar: calendarState === "connected" ? "available" : calendarState,
        gmail: gmailState === "connected" ? "available" : gmailState,
        bookings: this.options.simulated ? "simulated" : "available",
        reminders: "available",
      },
      events: [],
      calls: [],
      reminders: [],
      emails: [],
    };
    const reads: Promise<void>[] = [];
    if (["connected", "simulated"].includes(calendarState))
      reads.push(
        (async () => {
          try {
            const events = await this.options.calendar.list(
              { start: day.start, end: day.end },
              signal,
            );
            result.events = events
              .filter(
                (event) =>
                  !event.deleted &&
                  (/^\d{4}-\d{2}-\d{2}$/.test(event.start)
                    ? event.start <= day.date && event.end > day.date
                    : Date.parse(event.start) < Date.parse(day.end) &&
                      Date.parse(event.end) > Date.parse(day.start)),
              )
              .sort((a, b) => a.start.localeCompare(b.start))
              .slice(0, 20);
          } catch {
            signal?.throwIfAborted();
            result.sources.calendar = "unavailable";
          }
        })(),
      );
    if (gmailState === "connected")
      reads.push(
        (async () => {
          if (!this.options.mail) {
            result.sources.gmail = "unavailable";
            return;
          }
          try {
            const mail = await this.options.mail(
              "in:inbox newer_than:2d",
              signal,
            );
            result.emails = mail
              .slice(0, 10)
              .map(({ id, subject, from, date }) => ({
                id,
                subject: briefText(subject),
                from: briefText(from),
                date,
              }));
          } catch {
            signal?.throwIfAborted();
            result.sources.gmail = "unavailable";
          }
        })(),
      );
    try {
      result.calls = this.options.calls
        .listAll()
        .filter(
          (call) =>
            !call.supersededBy &&
            (active.has(call.status) ||
              (call.bookedSlot &&
                Date.parse(call.bookedSlot.start) >= Date.parse(day.start) &&
                Date.parse(call.bookedSlot.start) < Date.parse(day.end)) ||
              (call.finishedAt !== undefined &&
                call.finishedAt >= Date.parse(day.start) &&
                call.finishedAt <= now)),
        )
        .sort(
          (a, b) =>
            Number(!active.has(a.status)) - Number(!active.has(b.status)) ||
            (b.updatedAt ?? b.finishedAt ?? b.expiresAt) -
              (a.updatedAt ?? a.finishedAt ?? a.expiresAt),
        )
        .slice(0, 10);
    } catch {
      result.sources.bookings = "unavailable";
    }
    try {
      result.reminders = this.options.reminders
        .list()
        .filter(
          (reminder) =>
            reminder.status === "pending" &&
            Date.parse(reminder.dueAt) < Date.parse(day.end),
        )
        .slice(0, 20);
    } catch {
      result.sources.reminders = "unavailable";
    }
    await Promise.all(reads);
    signal?.throwIfAborted();
    const sentences: string[] = [];
    const booking = result.calls[0];
    if (booking) {
      const business = briefText(booking.booking.destinationName);
      if (booking.status === "pending")
        sentences.push(
          `Your call to ${business} is waiting for your approval.`,
        );
      else if (["starting", "queued", "in_progress"].includes(booking.status))
        sentences.push(
          `Jolly is handling your call to ${business}; the booking is not confirmed yet.`,
        );
      else if (booking.status === "uncertain")
        sentences.push(
          `The outcome of your call to ${business} needs checking.`,
        );
      else if (
        booking.status === "completed" &&
        ["booked", "rescheduled"].includes(booking.outcome ?? "") &&
        booking.bookedSlot
      ) {
        const at = new Intl.DateTimeFormat("en-GB", {
          timeZone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(booking.bookedSlot.start));
        sentences.push(
          `${business} confirmed your ${briefText(booking.booking.purpose)} for ${at}.`,
        );
      } else if (
        booking.status === "completed" &&
        booking.outcome === "booking_cancelled"
      )
        sentences.push(`${business} confirmed cancellation of your booking.`);
      else
        sentences.push(
          `Your call to ${business} ended without a verified new booking.`,
        );
    } else if (result.sources.bookings === "unavailable")
      sentences.push("Booking updates are unavailable right now.");
    if (["available", "simulated"].includes(result.sources.calendar)) {
      sentences.push(
        result.events.length
          ? `You have ${result.events.length}${result.events.length === 20 ? " or more" : ""} Calendar ${result.events.length === 1 ? "event" : "events"} today.`
          : "Your Calendar has no events today.",
      );
    } else
      sentences.push(
        result.sources.calendar === "disabled"
          ? "Calendar is switched off."
          : result.sources.calendar === "disconnected"
            ? "Calendar is not connected."
            : "Calendar could not be checked.",
      );
    if (result.sources.reminders === "unavailable")
      sentences.push("Reminders could not be checked.");
    else if (result.reminders.length) {
      const overdue = result.reminders.filter(
        (r) => Date.parse(r.dueAt) <= now,
      ).length;
      sentences.push(
        `${result.reminders.length}${result.reminders.length === 20 ? " or more" : ""} ${result.reminders.length === 1 ? "reminder needs" : "reminders need"} attention${overdue ? `, including ${overdue} due now or overdue` : " today"}.`,
      );
    }
    if (result.sources.gmail === "available")
      sentences.push(
        result.emails.length
          ? `Your recent inbox sample has ${result.emails.length} ${result.emails.length === 1 ? "message" : "messages"} to review.`
          : "No messages were found in your recent inbox sample.",
      );
    else if (result.sources.gmail === "unavailable")
      sentences.push("Email could not be checked.");
    else if (result.sources.gmail === "disconnected")
      sentences.push("Email is not connected.");
    result.summary = sentences.join(" ");
    return result;
  }
}
