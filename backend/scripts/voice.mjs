import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { api } from "./client.mjs";
if (!process.argv[2])
  throw new Error("Usage: npm run voice -- /absolute/path/recording.wav");
const session = await api("/v1/sessions", {
  timeZone: process.env.USER_TIMEZONE || "Europe/London",
});
const response = await api(
  `/v1/sessions/${session.id}/audio`,
  readFileSync(process.argv[2]),
  "POST",
  { "Content-Type": "audio/wav", "Idempotency-Key": randomUUID() },
);
console.log(JSON.stringify(response, null, 2));
console.log(
  "No action was approved. Session retained for follow-up; see README for confirmation and deletion endpoints.",
);
