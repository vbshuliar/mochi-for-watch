import { z } from "zod";
export const zone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone");
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const recurrence = z.enum(["none", "daily", "weekly"]);
export const reminderInputSchema = z
  .object({
    id: z.uuid().optional(),
    title: z.string().trim().min(1).max(160),
    dueAt: instant,
    timeZone: zone,
    recurrence: recurrence.default("none"),
    sourceCallId: z.uuid().optional(),
  })
  .strict();
export const reminderUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    dueAt: instant.optional(),
    timeZone: zone.optional(),
    recurrence: recurrence.optional(),
    status: z.enum(["pending", "completed"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Choose a reminder change");
