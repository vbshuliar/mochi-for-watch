import { z } from "zod";
import {
  reminderInputSchema,
  reminderUpdateSchema,
} from "./reminder-schema.ts";
import { gmailDraftInputSchema } from "./gmail-draft-schema.ts";
export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const timezone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone");
const dateTime = z.iso.datetime({ offset: true });
export const eventSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    start: dateTime,
    end: dateTime,
    timeZone: timezone,
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.end) > Date.parse(v.start) &&
      Date.parse(v.end) - Date.parse(v.start) <= 86400000,
    "Event must last between 0 and 24 hours",
  );
export type EventInput = z.infer<typeof eventSchema>;
export const windowSchema = z
  .object({ start: dateTime, end: dateTime })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.end) > Date.parse(v.start) &&
      Date.parse(v.end) - Date.parse(v.start) <= 31 * 86400000,
    "Window must be at most 31 days",
  );
export type Window = z.infer<typeof windowSchema>;
export const sourceSchema = z
  .object({
    title: z.string().min(1).max(300),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        );
      }),
  })
  .strict();
export type SearchSource = z.infer<typeof sourceSchema>;
export const memoryInputSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(500),
  })
  .strict();
export type Memory = z.infer<typeof memoryInputSchema> & {
  id: string;
  updatedAt: number;
};
export type PlanOptions = {
  contactLookupSupported?: boolean;
  selectedContact?: {
    displayName: string;
    phoneNumber: string;
    phoneLabel?: string;
  };
  bookingProfile?: import("./booking-profile.ts").BookingProfile | null;
  signal?: AbortSignal;
  onText?: (text: string) => void;
  memories?: Memory[];
  reminders?: Array<{
    id: string;
    title: string;
    dueAt: string;
    status: string;
  }>;
  latestCall?: {
    id?: string;
    status: string;
    progress?: string;
    summary?: string;
    destinationName: string;
  };
};
export const workflowPlan = z
  .object({
    kind: z.literal("workspace_task"),
    instruction: z.string().trim().min(1).max(1500),
    gmailQuery: z.string().trim().min(1).max(500).optional(),
    destination: z.enum(["reply", "notion"]),
  })
  .strict();
export type WorkspacePlan = z.infer<typeof workflowPlan>;
export const contactSelectionSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
    phoneLabel: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
export const contactLookupResponseSchema = z
  .object({
    requestId: z.uuid(),
    status: z.enum([
      "selected",
      "not_found",
      "denied",
      "unavailable",
      "cancelled",
    ]),
    contact: contactSelectionSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.status === "selected") !== Boolean(v.contact))
      ctx.addIssue({
        code: "custom",
        message: "Only selected lookups require a contact",
      });
  });
export type ContactLookupResponse = z.infer<typeof contactLookupResponseSchema>;
export const conversationSchema = z
  .object({
    destinationName: z.string().trim().min(1).max(120),
    phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
    purpose: z.string().trim().min(1).max(300),
    customerName: z.string().trim().min(1).max(120),
    timeZone: timezone,
  })
  .strict();
export type ConversationInput = z.infer<typeof conversationSchema>;
export const bookingSchema = z
  .object({
    destinationName: z.string().trim().min(1).max(120),
    phoneNumber: z.string().regex(/^\+[1-9]\d{7,14}$/),
    purpose: z.string().trim().min(1).max(300),
    customerName: z.string().trim().min(1).max(120),
    timeZone: timezone,
    window: windowSchema,
    windows: z.array(windowSchema).min(1).max(14).optional(),
    durationMinutes: z.number().int().min(5).max(240),
  })
  .strict()
  .superRefine((booking, ctx) => {
    const windows = [...(booking.windows ?? [])].sort(
      (a, b) => Date.parse(a.start) - Date.parse(b.start),
    );
    for (let i = 0; i < windows.length; i++) {
      const window = windows[i]!;
      if (
        Date.parse(window.start) < Date.parse(booking.window.start) ||
        Date.parse(window.end) > Date.parse(booking.window.end) ||
        (i > 0 && Date.parse(window.start) < Date.parse(windows[i - 1]!.end))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["windows"],
          message:
            "Allowed windows must be within the envelope and must not overlap",
        });
      }
    }
  });
export type BookingInput = z.infer<typeof bookingSchema>;
export const bookingChangeSchema = z
  .object({
    operation: z.enum(["reschedule", "cancel_booking"]),
    window: windowSchema.optional(),
    windows: z.array(windowSchema).min(1).max(14).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operation === "reschedule" && !value.window)
      ctx.addIssue({
        code: "custom",
        path: ["window"],
        message: "Choose the new allowed booking window",
      });
    if (value.operation === "cancel_booking" && (value.window || value.windows))
      ctx.addIssue({
        code: "custom",
        message: "Cancellation cannot include new booking windows",
      });
  });
export type BookingChange = z.infer<typeof bookingChangeSchema>;
export const planSchema = z.discriminatedUnion("kind", [
  workflowPlan,
  z
    .object({
      kind: z.literal("lookup_contact"),
      query: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({ kind: z.literal("call_delegate"), request: conversationSchema })
    .strict(),
  z.object({ kind: z.literal("daily_briefing") }).strict(),
  z.object({ kind: z.literal("list_reminders") }).strict(),
  z
    .object({
      kind: z.literal("create_reminder"),
      reminder: reminderInputSchema.omit({ id: true }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("update_reminder"),
      id: z.uuid(),
      changes: reminderUpdateSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("gmail_draft"), draft: gmailDraftInputSchema })
    .strict(),
  z
    .object({
      kind: z.literal("social_task"),
      provider: z.enum(["instagram", "facebook"]),
      instruction: z.string().trim().min(1).max(1500),
    })
    .strict(),
  z.object({ kind: z.literal("call_status") }).strict(),
  z
    .object({
      kind: z.literal("change_booking"),
      callId: z.uuid(),
      change: bookingChangeSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("call_booking"), booking: bookingSchema })
    .strict(),
  z
    .object({
      kind: z.literal("remember"),
      id: z.uuid().optional(),
      memory: memoryInputSchema,
    })
    .strict(),
  z.object({ kind: z.literal("forget"), id: z.uuid() }).strict(),
  z
    .object({
      kind: z.literal("reply"),
      text: z.string().min(1).max(500),
      sources: z.array(sourceSchema).max(8).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal("clarify"), text: z.string().min(1).max(300) })
    .strict(),
  z.object({ kind: z.literal("create_event"), event: eventSchema }).strict(),
  z.object({ kind: z.literal("list_events"), window: windowSchema }).strict(),
  z.object({ kind: z.literal("availability"), window: windowSchema }).strict(),
]);
export type Plan = z.infer<typeof planSchema>;
export type Message = { role: "user" | "assistant"; content: string };
export type Session = {
  id: string;
  timeZone: string;
  messages: Message[];
  createdAt: number;
  pendingContactLookupId?: string;
  selectedContact?: {
    lookupId: string;
    contact: z.infer<typeof contactSelectionSchema>;
    expiresAt: number;
  };
};
export type Action = {
  operation?: "update" | "delete";
  targetReceipt?: Receipt;
  sourceActionId?: string;
  id: string;
  sessionId: string;
  event: EventInput;
  status:
    | "pending"
    | "executing"
    | "completed"
    | "uncertain"
    | "cancelled"
    | "expired";
  expiresAt: number;
  receipt?: Receipt;
};
export type Receipt = {
  id: string;
  title: string;
  start: string;
  end: string;
  simulated: boolean;
  url?: string;
  deleted?: boolean;
};
export type Timeline = { at: string; state: string; statusText: string };
export type TurnResult = {
  sessionId: string;
  state: string;
  statusText: string;
  speechText: string;
  simulated: boolean;
  returnTo?: { state: "idle"; afterMs: number };
  contactLookup?: { id: string; query: string; expiresAt: number };
  action?: Action;
  callAction?: import("./calls.ts").PublicCallAction;
  documentAction?: import("./workflows.ts").DocumentAction;
  gmailDraftAction?: import("./gmail-drafts.ts").GmailDraftAction;
  data?: unknown;
  sources?: SearchSource[];
};
export interface Planner {
  plan(
    messages: Message[],
    timeZone: string,
    options?: PlanOptions,
  ): Promise<Plan>;
  transcribe(audio: Buffer, signal?: AbortSignal): Promise<string>;
}
export interface Calendar {
  list(window: Window, signal?: AbortSignal): Promise<Receipt[]>;
  busy(window: Window, signal?: AbortSignal): Promise<Window[]>;
  busyExcluding?(
    window: Window,
    sourceActionId: string,
    target: Receipt,
    signal?: AbortSignal,
  ): Promise<Window[]>;
  create(id: string, event: EventInput): Promise<Receipt>;
  change?(
    id: string,
    sourceActionId: string,
    target: Receipt,
    operation: "update" | "delete",
    event: EventInput,
  ): Promise<Receipt>;
}
export function validateWav(audio: Buffer) {
  if (
    audio.length < 44 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new AppError(400, "invalid_audio", "send a PCM WAV recording");
  let offset = 12,
    bytesPerSecond = 0,
    dataBytes = 0;
  while (offset + 8 <= audio.length) {
    const name = audio.toString("ascii", offset, offset + 4),
      size = audio.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + size > audio.length)
      throw new AppError(400, "invalid_audio", "incomplete WAV recording");
    if (name === "fmt ") {
      if (
        size < 16 ||
        audio.readUInt16LE(offset) !== 1 ||
        audio.readUInt16LE(offset + 2) !== 1 ||
        audio.readUInt16LE(offset + 14) !== 16
      )
        throw new AppError(400, "invalid_audio", "use mono 16-bit PCM WAV");
      const rate = audio.readUInt32LE(offset + 4);
      bytesPerSecond = audio.readUInt32LE(offset + 8);
      if (
        ![16000, 24000, 44100, 48000].includes(rate) ||
        bytesPerSecond !== rate * 2 ||
        audio.readUInt16LE(offset + 12) !== 2
      )
        throw new AppError(
          400,
          "invalid_audio",
          "unsupported WAV sample format",
        );
    }
    if (name === "data") dataBytes += size;
    offset += size + (size % 2);
  }
  if (!bytesPerSecond || !dataBytes || dataBytes / bytesPerSecond > 60)
    throw new AppError(
      400,
      "invalid_audio",
      "record between a moment and 60 seconds",
    );
}
