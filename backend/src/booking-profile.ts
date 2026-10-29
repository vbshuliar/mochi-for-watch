import { z } from "zod";
import type { Store } from "./store.ts";
import { zone } from "./reminder-schema.ts";

const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const bookingProfileSchema = z
  .object({
    destinationName: z.string().trim().min(1).max(120),
    phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
    purpose: z.string().trim().min(1).max(120),
    customerName: z.string().trim().min(1).max(120),
    durationMinutes: z.number().int().min(5).max(240),
    timeZone: zone,
    preferredDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    preferredStart: localTime,
    preferredEnd: localTime,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.preferredDays).size !== value.preferredDays.length)
      ctx.addIssue({
        code: "custom",
        path: ["preferredDays"],
        message: "Choose each weekday once.",
      });
    if (value.preferredEnd <= value.preferredStart)
      ctx.addIssue({
        code: "custom",
        path: ["preferredEnd"],
        message:
          "End time must be later on the same day. Overnight preferences are not supported.",
      });
    const minutes = (time: string) =>
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    if (
      minutes(value.preferredEnd) - minutes(value.preferredStart) <
      value.durationMinutes
    )
      ctx.addIssue({
        code: "custom",
        path: ["durationMinutes"],
        message: "The appointment must fit inside the preferred hours.",
      });
  });
export type BookingProfileInput = z.infer<typeof bookingProfileSchema>;
export type BookingProfile = BookingProfileInput & { updatedAt: number };

// One owner's explicit preferences, stored through the encrypted record store.
// Saving a number is neither destination approval nor permission to place a call.
export class BookingProfiles {
  constructor(private store: Store) {}
  get(): BookingProfile | null {
    return this.store.get<BookingProfile>("booking-profile", "usual") ?? null;
  }
  save(input: unknown): BookingProfile {
    const parsed = bookingProfileSchema.parse(input);
    const profile = {
      ...parsed,
      preferredDays: [...parsed.preferredDays].sort((a, b) => a - b),
      updatedAt: Date.now(),
    };
    this.store.put("booking-profile", "usual", profile);
    return profile;
  }
  remove() {
    this.store.delete("booking-profile", "usual");
  }
}
