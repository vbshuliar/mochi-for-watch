import { z } from "zod";
import { AppError } from "./domain.ts";
import type { Calls } from "./calls.ts";
import type { Reminders } from "./reminders.ts";
import { zone } from "./reminder-schema.ts";

export const bookingReminderSchema = z
  .object({
    id: z.uuid(),
    dueAt: z.iso.datetime({ offset: true }),
    timeZone: zone,
  })
  .strict();

export class BookingSupport {
  constructor(
    private calls: Calls,
    private reminders: Reminders,
  ) {}
  remind(sessionId: string, callId: string, input: unknown) {
    const body = bookingReminderSchema.parse(input);
    const call = this.calls.publicAction(this.calls.get(sessionId, callId));
    if (!call.followUp?.canAddReminder || !call.bookedSlot)
      throw new AppError(
        409,
        "booking_not_remindable",
        "Choose a current confirmed future booking before adding a reminder.",
      );
    if (Date.parse(body.dueAt) >= Date.parse(call.bookedSlot.start))
      throw new AppError(
        422,
        "reminder_after_booking",
        "Choose a reminder time before the appointment.",
      );
    return this.reminders.create({
      ...body,
      title: `${call.booking.purpose} at ${call.booking.destinationName}`.slice(
        0,
        160,
      ),
      recurrence: "none",
      sourceCallId: callId,
    });
  }
}
