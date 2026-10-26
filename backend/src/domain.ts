import { z } from "zod";
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
export const planSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("reply"), text: z.string().min(1).max(500) })
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
};
export type Action = {
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
};
export type Timeline = { at: string; state: string; statusText: string };
export type TurnResult = {
  sessionId: string;
  state: string;
  statusText: string;
  speechText: string;
  simulated: boolean;
  returnTo?: { state: "idle"; afterMs: number };
  action?: Action;
  data?: unknown;
};
export interface Planner {
  plan(messages: Message[], timeZone: string): Promise<Plan>;
  transcribe(audio: Buffer): Promise<string>;
}
export interface Calendar {
  list(window: Window): Promise<Receipt[]>;
  busy(window: Window): Promise<Window[]>;
  create(id: string, event: EventInput): Promise<Receipt>;
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
