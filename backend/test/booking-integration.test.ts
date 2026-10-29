import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import type { Planner, PlanOptions } from "../src/domain.ts";
process.env.NODE_ENV = "test";
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
});
const profile = {
  destinationName: "Salon",
  phoneNumber: "+442012345679",
  purpose: "haircut",
  customerName: "Alex",
  durationMinutes: 30,
  timeZone: "Europe/London",
  preferredDays: [1, 2, 3, 4, 5],
  preferredStart: "14:00",
  preferredEnd: "18:00",
};
test("usual profile reaches planner and authorizes number provenance only, never dials; deletion removes authority", async (t) => {
  let options: PlanOptions | undefined;
  const planner: Planner = {
    transcribe: async () => "",
    plan: async (_m, _z, o) => {
      options = o;
      return {
        kind: "call_booking",
        booking: {
          destinationName: profile.destinationName,
          phoneNumber: profile.phoneNumber,
          purpose: profile.purpose,
          customerName: profile.customerName,
          durationMinutes: 30,
          timeZone: profile.timeZone,
          window: {
            start: "2030-11-05T14:00:00Z",
            end: "2030-11-05T16:00:00Z",
          },
        },
      };
    },
  };
  const f = await buildApp(config, { planner });
  t.after(() => f.app.close());
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("No provider operations during setup/proposal");
  });
  const headers = { authorization: `Bearer ${config.API_TOKEN}` };
  const saved = await f.app.inject({
    method: "PUT",
    url: "/v1/booking-profile",
    headers,
    payload: profile,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const session = f.service.createSession("Europe/London");
  const proposal = await f.service.turn(session.id, randomUUID(), {
    text: "Book my usual haircut next week",
  });
  assert.equal(options?.bookingProfile?.destinationName, "Salon");
  assert.equal(proposal.callAction?.status, "pending");
  assert.equal(f.store.list("call-attempt").length, 0);
  assert.equal(
    (await f.app.inject({ url: "/v1/readiness", headers })).json().readyForDemo,
    false,
  );
  await f.app.inject({ method: "DELETE", url: "/v1/booking-profile", headers });
  const fresh = f.service.createSession("Europe/London");
  await assert.rejects(
    f.service.turn(fresh.id, randomUUID(), {
      text: "Book my usual haircut next week",
    }),
  );
  assert.equal(options?.bookingProfile, null);
});
