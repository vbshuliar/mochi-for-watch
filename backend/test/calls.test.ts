import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import {
  Calls,
  confirmsSlot,
  isConditionalConfirmation,
  startTimeRanges,
  conciseTimeOffer,
  type CallAction,
} from "../src/calls.ts";
import { readConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { MetaPlanner } from "../src/meta.ts";
import { buildApp } from "../src/app.ts";
import {
  type BookingInput,
  type Calendar,
  bookingSchema,
} from "../src/domain.ts";
process.env.NODE_ENV = "test";
const config = readConfig({
  APP_MODE: "live",
  MODEL_API_KEY: "meta",
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  DATABASE_PATH: ":memory:",
  ELEVENLABS_API_KEY: "voice",
  TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32),
  TWILIO_AUTH_TOKEN: "twilio",
  TWILIO_FROM_NUMBER: "+442012345678",
  TWILIO_ALLOWED_NUMBERS: "+442012345679",
  CALLS_PUBLIC_URL: "https://calls.example.com",
});
const booking: BookingInput = {
  destinationName: "Salon",
  phoneNumber: "+442012345679",
  purpose: "haircut",
  customerName: "Alex",
  timeZone: "Europe/London",
  window: { start: "2030-11-05T10:00:00Z", end: "2030-11-05T12:00:00Z" },
  durationMinutes: 30,
};
const sid = "CA" + "c".repeat(32);
const calendar: Calendar = {
  async busy() {
    return [];
  },
  async list() {
    return [];
  },
  async create() {
    throw new Error("Must not create Calendar automatically");
  },
};
function fixture(t: any, connected = false, cal = calendar) {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  const calls = new Calls(config, store, cal, () => connected);
  t.after(async () => {
    await calls.close();
    store.close();
  });
  return { store, calls };
}
function providers(
  t: any,
  model: unknown = { text: "Thank you, goodbye.", outcome: "not_booked" },
) {
  const counts = { dial: 0, meta: 0, voice: 0, stop: 0 };
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    if (String(url).includes("elevenlabs")) {
      counts.voice++;
      return new Response(Buffer.from("mp3"), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    }
    if (String(url).includes("api.meta.ai")) {
      counts.meta++;
      const input = JSON.parse(init.body);
      assert.equal(input.tools, undefined);
      assert.match(input.messages[0].content, /Never make payments/);
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(model) },
          },
        ],
      });
    }
    if (String(url).endsWith("Calls.json")) {
      counts.dial++;
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("TimeLimit"), "300");
      assert.equal(form.get("Record"), "false");
      assert.deepEqual(form.getAll("StatusCallbackEvent"), [
        "initiated",
        "ringing",
        "answered",
        "completed",
      ]);
      return Response.json({ sid });
    }
    counts.stop++;
    return Response.json({ sid });
  });
  return counts;
}
async function started(calls: Calls) {
  const a = (await calls.prepare(randomUUID(), booking)).callAction!;
  await calls.decide(a.sessionId, a.id, "confirm");
  return calls.get(a.sessionId, a.id);
}
const callback = { AccountSid: config.TWILIO_ACCOUNT_SID, CallSid: sid };
test("configuration fail closed, explicit fields and allowlist", async (t) => {
  const { calls, store } = fixture(t);
  assert.equal(
    new Calls(
      { ...config, TWILIO_ALLOWED_NUMBERS: "" },
      store,
      calendar,
      () => false,
    ).configured(),
    false,
  );
  assert.equal(
    new Calls(
      { ...config, CALLS_PUBLIC_URL: "http://example.com" },
      store,
      calendar,
      () => false,
    ).configured(),
    false,
  );
  assert.throws(() =>
    bookingSchema.parse({ ...booking, phoneNumber: "02012345678" }),
  );
  assert.throws(() => bookingSchema.parse({ ...booking, customerName: "" }));
  await assert.rejects(
    calls.prepare(randomUUID(), { ...booking, phoneNumber: "+442012345670" }),
    /isn’t enabled/,
  );
});
test("proposal filters busy intervals, honestly labels disconnected, never dials", async (t) => {
  const counts = providers(t);
  const { calls } = fixture(t, true, {
    ...calendar,
    async busy() {
      return [{ start: "2030-11-05T10:15:00Z", end: "2030-11-05T11:00:00Z" }];
    },
  });
  const a = (await calls.prepare(randomUUID(), booking)).callAction!;
  assert.equal(a.calendarChecked, true);
  assert.equal(
    calls.get(a.sessionId, a.id).slots[0].start,
    "2030-11-05T11:00:00.000Z",
  );
  assert.equal(counts.dial, 0);
  const disconnected = fixture(t).calls;
  assert.match(
    (await disconnected.prepare(randomUUID(), booking)).speechText,
    /Calendar not checked/,
  );
});
test("approval is session bound, expires and decisions are idempotent", async (t) => {
  const counts = providers(t);
  const { calls, store } = fixture(t);
  const a = (await calls.prepare(randomUUID(), booking)).callAction!;
  await assert.rejects(
    calls.decide(randomUUID(), a.id, "confirm"),
    /not found/,
  );
  await Promise.all([
    calls.decide(a.sessionId, a.id, "confirm"),
    calls.decide(a.sessionId, a.id, "confirm"),
  ]);
  assert.equal(counts.dial, 1);
  await calls.decide(a.sessionId, a.id, "confirm");
  assert.equal(counts.dial, 1);
  await assert.rejects(
    calls.decide(a.sessionId, a.id, "cancel"),
    /already has a decision/,
  );
  calls.status(a.id, {
    ...callback,
    SequenceNumber: "0",
    CallStatus: "completed",
  });
  const b = (await calls.prepare(randomUUID(), booking)).callAction!;
  store.put("call", b.id, { ...b, expiresAt: Date.now() - 1 });
  await assert.rejects(
    calls.decide(b.sessionId, b.id, "confirm"),
    /no longer active/,
  );
  const c = (await calls.prepare(randomUUID(), booking)).callAction!;
  assert.equal(
    (await calls.decide(c.sessionId, c.id, "cancel")).callAction?.status,
    "cancelled",
  );
  assert.equal(
    (await calls.decide(c.sessionId, c.id, "cancel")).callAction?.status,
    "cancelled",
  );
  assert.equal(counts.dial, 1);
});
test("ambiguous call creation is persisted and never retried", async (t) => {
  const { calls } = fixture(t);
  let dial = 0;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url).includes("elevenlabs"))
      return new Response("audio", {
        headers: { "Content-Type": "audio/mpeg" },
      });
    dial++;
    throw new Error("lost response");
  });
  const a = await started(calls);
  assert.equal(a.status, "uncertain");
  assert.equal(
    (await calls.decide(a.sessionId, a.id, "confirm")).callAction?.status,
    "uncertain",
  );
  assert.equal(dial, 1);
});
test("signature binds canonical public URL and all sorted form parameters", async (t) => {
  const { calls } = fixture(t);
  const path = "/webhooks/calls/test/status",
    body = { ...callback, CallStatus: "completed", SequenceNumber: "1" };
  const sig = createHmac("sha1", config.TWILIO_AUTH_TOKEN)
    .update(
      config.CALLS_PUBLIC_URL +
        path +
        Object.keys(body)
          .sort()
          .map((k) => k + body[k as keyof typeof body])
          .join(""),
    )
    .digest("base64");
  calls.verify(path, body, sig);
  assert.throws(() =>
    calls.verify(path, { ...body, CallStatus: "in-progress" }, sig),
  );
  assert.throws(() => calls.verify(path + "?x=1", body, sig));
  assert.throws(() => calls.verify(path, body, ""));
});
test("CallSid association, callback sequence and terminal state reject reordering", async (t) => {
  providers(t);
  const { calls } = fixture(t);
  const a = await started(calls);
  assert.throws(() =>
    calls.voice(a.id, 0, { ...callback, CallSid: "CA" + "f".repeat(32) }),
  );
  calls.status(a.id, {
    ...callback,
    CallStatus: "in-progress",
    SequenceNumber: "2",
  });
  calls.status(a.id, { ...callback, CallStatus: "busy", SequenceNumber: "1" });
  assert.equal(calls.get(a.sessionId, a.id).status, "in_progress");
  calls.status(a.id, {
    ...callback,
    CallStatus: "completed",
    SequenceNumber: "3",
  });
  calls.status(a.id, {
    ...callback,
    CallStatus: "in-progress",
    SequenceNumber: "4",
  });
  assert.equal(calls.get(a.sessionId, a.id).status, "completed");
  assert.equal(calls.get(a.sessionId, a.id).outcome, undefined);
  assert.throws(() => calls.proposeCalendar(a.sessionId, a.id), /No confirmed/);
});
test("Gather returns quickly, deduplicates persisted turns, and validates confirmed slot", async (t) => {
  const speech = "Confirmed, booked for Alex on 5 November at 10:00.";
  const counts = providers(t, {
    text: "Thank you, goodbye.",
    outcome: "booked",
    slotIndex: 0,
    confirmationQuote: speech,
  });
  const { calls, store } = fixture(t, true);
  const a = await started(calls);
  const intro = calls.voice(a.id, 0, callback);
  assert.match(intro, /^<Response><Play>/);
  assert.match(intro, /Gather input="speech"/);
  assert.equal(
    store.list<any>("call-turn")[0].value.text.includes("AI assistant"),
    true,
  );
  const before = Date.now();
  assert.match(
    calls.gather(a.id, 0, { ...callback, SpeechResult: speech }),
    /<Pause/,
  );
  assert.ok(Date.now() - before < 100);
  calls.gather(a.id, 0, { ...callback, SpeechResult: speech });
  await calls.close();
  assert.equal(counts.meta, 1);
  assert.match(calls.voice(a.id, 1, callback), /<Hangup/);
  assert.equal(calls.get(a.sessionId, a.id).outcome, "booked");
  const proposal = calls.proposeCalendar(a.sessionId, a.id);
  assert.equal(proposal.action?.status, "pending");
  assert.equal(
    calls.proposeCalendar(a.sessionId, a.id).action?.id,
    proposal.action?.id,
  );
  assert.equal(store.list("action").length, 1);
});
test("out of range slot or absent date/time fails closed", async (t) => {
  providers(t, {
    text: "Booked.",
    outcome: "booked",
    slotIndex: 999,
    confirmationQuote: "Booked.",
  });
  const { calls } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, { ...callback, SpeechResult: "Booked." });
  await calls.close();
  assert.match(calls.voice(a.id, 1, callback), /<Hangup/);
  assert.equal(calls.get(a.sessionId, a.id).outcome, undefined);
  assert.equal(
    confirmsSlot(
      "Confirmed 5 November 11:00",
      { start: "2030-11-05T10:00:00Z", end: "2030-11-05T10:30:00Z" },
      "Europe/London",
    ),
    false,
  );
  assert.equal(
    confirmsSlot(
      "Confirmed 15 November 10:00",
      { start: "2030-11-05T10:00:00Z", end: "2030-11-05T10:30:00Z" },
      "Europe/London",
    ),
    false,
  );
});
test("silence, turn cap, pending timeout, and hard duration terminate", async (t) => {
  const counts = providers(t);
  const { calls, store } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, callback);
  await calls.close();
  assert.equal(counts.meta, 0);
  calls.voice(a.id, 1, callback);
  assert.equal(calls.get(a.sessionId, a.id).outcome, "not_booked");
  const b = await started(calls);
  store.put("call", b.id, { ...b, turn: 11 });
  calls.gather(b.id, 11, { ...callback, SpeechResult: "hello" });
  await calls.close();
  calls.voice(b.id, 12, callback);
  assert.equal(counts.meta, 0);
  const c = await started(calls);
  store.put("call-turn", `${c.id}:0`, {
    status: "pending",
    createdAt: Date.now() - 46000,
  });
  assert.match(calls.voice(c.id, 0, callback), /<Hangup/);
  assert.equal(calls.get(c.sessionId, c.id).status, "failed");
  const d = await started(calls);
  store.put("call", d.id, { ...d, startedAt: Date.now() - 301000 });
  assert.match(calls.voice(d.id, 0, callback), /<Hangup/);
});
test("stop prevents late background audio or booked state, startup recovers uncertain", async (t) => {
  providers(t);
  const { calls, store } = fixture(t);
  const a = await started(calls);
  await calls.stop(a.sessionId, a.id);
  assert.equal(calls.get(a.sessionId, a.id).status, "stopped");
  assert.match(
    calls.gather(a.id, 0, { ...callback, SpeechResult: "booked" }),
    /<Hangup/,
  );
  const b = await started(calls);
  new Calls(config, store, calendar, () => false);
  assert.equal(calls.get(b.sessionId, b.id).status, "uncertain");
  assert.equal(store.list("call-audio").length, 0);
});
test("audio uses opaque scoped expiring tokens and application endpoints require auth", async (t) => {
  providers(t);
  const { calls, store } = fixture(t);
  const a = await started(calls);
  const audio = store.list<any>("call-audio")[0];
  assert.match(audio.id, /^[a-f0-9]{64}$/);
  assert.ok(calls.audio(audio.id).length);
  store.put("call-audio", audio.id, {
    ...audio.value,
    expiresAt: Date.now() - 1,
  });
  assert.throws(() => calls.audio(audio.id), /not found/);
  const app = await buildApp(config, { calendar });
  t.after(() => app.app.close());
  for (const suffix of ["", "/decision", "/stop", "/calendar"]) {
    const r = await app.app.inject({
      method: suffix ? "POST" : "GET",
      url: `/v1/sessions/${a.sessionId}/calls/${a.id}${suffix}`,
      payload: suffix ? {} : undefined,
    });
    assert.equal(r.statusCode, 401);
  }
  const r = await app.app.inject({
    method: "POST",
    url: `/webhooks/calls/${a.id}/voice/0`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(callback).toString(),
  });
  assert.equal(r.statusCode, 403);
});

test("rechecked slots persist; negative confirmation asks for clarification", async (t) => {
  let reads = 0;
  const { calls } = fixture(t, true, {
    ...calendar,
    async busy() {
      return ++reads === 1
        ? []
        : [{ start: booking.window.start, end: "2030-11-05T11:00:00Z" }];
    },
  });
  providers(t, {
    text: "Your booking is confirmed.",
    outcome: "booked",
    slotIndex: 0,
    confirmationQuote: "Not booked for 5 November at 11:00.",
  });
  const a = await started(calls);
  assert.equal(
    calls.get(a.sessionId, a.id).slots[0].start,
    "2030-11-05T11:00:00.000Z",
  );
  calls.gather(a.id, 0, {
    ...callback,
    SpeechResult: "Not booked for 5 November at 11:00.",
  });
  await calls.close();
  assert.match(calls.voice(a.id, 1, callback), /<Gather/);
  assert.equal(calls.get(a.sessionId, a.id).outcome, undefined);
});

test("full authenticated plan, approval, signed turn, audio and outcome route flow", async (t) => {
  const speech = "Confirmed, booked for Alex on 5 November at 10:00.";
  const counts = providers(t, {
    text: "Thank you, goodbye.",
    outcome: "booked",
    slotIndex: 0,
    confirmationQuote: speech,
  });
  const built = await buildApp(config, {
    calendar,
    planner: {
      async plan() {
        return { kind: "call_booking" as const, booking };
      },
      async transcribe() {
        return "";
      },
    },
  });
  t.after(() => built.app.close());
  const headers = { authorization: `Bearer ${config.API_TOKEN}` };
  const session = (
    await built.app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers,
      payload: { timeZone: "Europe/London" },
    })
  ).json().id;
  const response = await built.app.inject({
    method: "POST",
    url: `/v1/sessions/${session}/turns`,
    headers,
    payload: {
      requestId: randomUUID(),
      text: `Call Salon at ${booking.phoneNumber} to book my haircut.`,
    },
  });
  assert.equal(response.statusCode, 200);
  const action = response.json().callAction;
  assert.equal(action.status, "pending");
  assert.equal(counts.dial, 0);
  const root = `/v1/sessions/${session}/calls/${action.id}`;
  assert.equal(
    (
      await built.app.inject({
        method: "POST",
        url: root + "/decision",
        headers,
        payload: { decision: "confirm" },
      })
    ).statusCode,
    200,
  );
  const signed = async (path: string, extra: Record<string, string> = {}) => {
    const body = { ...callback, ...extra };
    const signature = createHmac("sha1", config.TWILIO_AUTH_TOKEN)
      .update(
        config.CALLS_PUBLIC_URL +
          path +
          Object.keys(body)
            .sort()
            .map((k) => k + body[k])
            .join(""),
      )
      .digest("base64");
    return built.app.inject({
      method: "POST",
      url: path,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature,
      },
      payload: new URLSearchParams(body).toString(),
    });
  };
  const voice = await signed(`/webhooks/calls/${action.id}/voice/0`);
  assert.equal(voice.statusCode, 200);
  assert.match(voice.body, /<Gather/);
  const audioUrl = voice.body.match(/<Play>([^<]+)/)![1];
  const audio = await built.app.inject(new URL(audioUrl).pathname);
  assert.equal(audio.statusCode, 200);
  assert.equal(audio.headers["content-type"], "audio/mpeg");
  assert.equal(
    (
      await signed(`/webhooks/calls/${action.id}/gather/0`, {
        SpeechResult: speech,
      })
    ).statusCode,
    200,
  );
  await built.calls.close();
  await signed(`/webhooks/calls/${action.id}/voice/1`);
  const outcome = (await built.app.inject({ url: root, headers })).json()
    .callAction;
  assert.equal(outcome.outcome, "booked");
  assert.equal(outcome.status, "completed");
  assert.equal(
    (
      await built.app.inject({
        method: "POST",
        url: root + "/calendar",
        headers,
        payload: {},
      })
    ).statusCode,
    409,
  );
  assert.equal(built.store.list("action").length, 0);
});

test("payment requests end without Meta; explicit no-payment-needed can continue", async (t) => {
  const counts = providers(t, {
    text: "Which time works?",
    outcome: "continue",
  });
  const { calls } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, {
    ...callback,
    SpeechResult: "Please pay a 50 pound deposit.",
  });
  await calls.close();
  calls.voice(a.id, 1, callback);
  assert.equal(counts.meta, 0);
  assert.equal(calls.get(a.sessionId, a.id).outcome, "not_booked");
  const b = await started(calls);
  calls.gather(b.id, 0, {
    ...callback,
    SpeechResult: "No deposit required. What time?",
  });
  await calls.close();
  assert.equal(counts.meta, 1);
});

test("stopped/deleted calls discard late model work and audio", async (t) => {
  let resolveModel!: (r: Response) => void;
  let voiceRequests = 0;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url).includes("elevenlabs")) {
      voiceRequests++;
      return new Response("audio", {
        headers: { "Content-Type": "audio/mpeg" },
      });
    }
    if (String(url).includes("api.meta.ai"))
      return new Promise<Response>((r) => {
        resolveModel = r;
      });
    return Response.json({ sid });
  });
  const { calls, store } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, { ...callback, SpeechResult: "Yes, what time?" });
  await calls.stop(a.sessionId, a.id);
  calls.deleteSession(a.sessionId);
  resolveModel(
    Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              text: "Which time?",
              outcome: "continue",
            }),
          },
        },
      ],
    }),
  );
  await calls.close();
  assert.equal(voiceRequests, 1);
  assert.equal(store.list("call-turn").length, 0);
  assert.equal(store.list("call-audio").length, 0);
});

test("current saved business phone supports call my barber; deleted or invented numbers are rejected", async (t) => {
  const seenMemories: any[] = [];
  const built = await buildApp(config, {
    calendar,
    planner: {
      async plan(_messages, _zone, options) {
        seenMemories.push(options?.memories);
        return { kind: "call_booking" as const, booking };
      },
      async transcribe() {
        return "";
      },
    },
  });
  t.after(() => built.app.close());
  const session = built.service.createSession("Europe/London");
  const memory = built.service.saveMemory({
    title: "My barber",
    text: `My barber is Test Salon. Business number ${booking.phoneNumber}.`,
  });
  const proposed = await built.service.turn(session.id, randomUUID(), {
    text: "Call my barber and book a haircut.",
  });
  assert.equal(proposed.callAction?.booking.phoneNumber, booking.phoneNumber);
  assert.equal(seenMemories[0][0].id, memory.id);
  built.service.deleteMemory(memory.id);
  await assert.rejects(
    built.service.turn(session.id, randomUUID(), {
      text: "Call my barber again.",
    }),
    /provide the destination phone number/,
  );
  assert.deepEqual(seenMemories[1], []);
  built.service.saveMemory({
    title: "My barber",
    text: "My barber's phone is +442012345670.",
  });
  await assert.rejects(
    built.service.turn(session.id, randomUUID(), { text: "Call my barber." }),
    /provide the destination phone number/,
  );
  await assert.rejects(
    built.service.turn(session.id, randomUUID(), {
      text: `Call ${booking.phoneNumber}9.`,
    }),
    /provide the destination phone number/,
  );
});

test("malformed model response retries once; fences and null optional fields are normalized", async (t) => {
  let meta = 0;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url).includes("elevenlabs"))
      return new Response("audio", {
        headers: { "Content-Type": "audio/mpeg" },
      });
    if (String(url).includes("api.meta.ai")) {
      meta++;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content:
                meta === 1
                  ? '{"text":'
                  : "```json\n" +
                    JSON.stringify({
                      text: "Would 10:00 work?",
                      outcome: "continue",
                      slotIndex: null,
                      confirmationQuote: null,
                    }) +
                    "\n```",
            },
          },
        ],
      });
    }
    return Response.json({ sid });
  });
  const { calls, store } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, { ...callback, SpeechResult: "What time?" });
  await calls.close();
  assert.equal(meta, 2);
  const turn = store.get<any>("call-turn", `${a.id}:1`);
  assert.equal(turn.status, "ready");
  assert.equal(turn.outcome, undefined);
  assert.equal(turn.attempt, 2);
});

test("persistent malformed output exposes safe parse category, never a false timeout", async (t) => {
  let meta = 0;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url).includes("elevenlabs"))
      return new Response("audio", {
        headers: { "Content-Type": "audio/mpeg" },
      });
    if (String(url).includes("api.meta.ai")) {
      meta++;
      return Response.json({
        choices: [
          {
            finish_reason: "length",
            message: { content: "private upstream garbage" },
          },
        ],
      });
    }
    return Response.json({ sid });
  });
  const { calls, store } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, { ...callback, SpeechResult: "Hello" });
  await calls.close();
  calls.voice(a.id, 1, callback);
  const action = calls.get(a.sessionId, a.id);
  assert.equal(meta, 2);
  const { elapsedMs, stageElapsedMs, ...safeFailure } = action.failure!;
  assert.ok(elapsedMs! >= 0);
  assert.ok(stageElapsedMs! >= 0);
  assert.deepEqual(safeFailure, {
    stage: "model_parse",
    category: "truncated_response",
    attempt: 2,
  });
  assert.match(action.summary!, /unusable response/);
  assert.doesNotMatch(
    JSON.stringify(store.list("call-turn")),
    /private upstream garbage/,
  );
});

test("speech provider failure records speech category without provider contents or retry", async (t) => {
  let voice = 0;
  let meta = 0;
  t.mock.method(globalThis, "fetch", async (url: any) => {
    if (String(url).includes("elevenlabs")) {
      voice++;
      return voice === 1
        ? new Response("audio", { headers: { "Content-Type": "audio/mpeg" } })
        : new Response("private provider details", { status: 503 });
    }
    if (String(url).includes("api.meta.ai")) {
      meta++;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                text: "Would 10:00 work?",
                outcome: "continue",
              }),
            },
          },
        ],
      });
    }
    return Response.json({ sid });
  });
  const { calls, store } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, { ...callback, SpeechResult: "Hello" });
  await calls.close();
  calls.voice(a.id, 1, callback);
  assert.equal(meta, 1);
  assert.equal(voice, 2);
  const { elapsedMs, stageElapsedMs, ...safeFailure } = calls.get(
    a.sessionId,
    a.id,
  ).failure!;
  assert.ok(elapsedMs! >= 0);
  assert.ok(stageElapsedMs! >= 0);
  assert.deepEqual(safeFailure, {
    stage: "speech",
    category: "unavailable",
    attempt: 1,
  });
  assert.match(calls.get(a.sessionId, a.id).summary!, /voice service failed/);
  assert.doesNotMatch(
    JSON.stringify(store.list("call-turn")),
    /private provider details/,
  );
});

test("natural ordinal dates are valid, but misheard customer names ask clarification", async (t) => {
  const speech = "Confirmed, booked for Alex on 5th of November at 10:00.";
  providers(t, {
    text: "Thank you, goodbye.",
    outcome: "booked",
    slotIndex: 0,
    confirmationQuote: speech,
  });
  const { calls, store } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, { ...callback, SpeechResult: speech });
  await calls.close();
  calls.voice(a.id, 1, callback);
  assert.equal(calls.get(a.sessionId, a.id).outcome, "booked");
  assert.equal(
    confirmsSlot(
      "Confirmed, booked for Vlad on 28th of October 16:30.",
      { start: "2026-10-28T16:30:00Z", end: "2026-10-28T17:00:00Z" },
      "Europe/London",
    ),
    true,
  );
  assert.equal(
    confirmsSlot(
      "Confirmed, booked for Vlad on 128th of October 16:30.",
      { start: "2026-10-28T16:30:00Z", end: "2026-10-28T17:00:00Z" },
      "Europe/London",
    ),
    false,
  );
  const b = await started(calls);
  calls.gather(b.id, 0, {
    ...callback,
    SpeechResult: "Yep, booking a lot 5th of November 10:00.",
  });
  await calls.close();
  assert.equal(store.get<any>("call-turn", `${b.id}:1`).outcome, undefined);
  assert.match(store.get<any>("call-turn", `${b.id}:1`).text, /for Alex/);
});

test("slot enumeration is replaced with a natural start-time range", async (t) => {
  providers(t, {
    text: "Would 10:00, 10:15, 10:30, 10:45, 11:00 or 11:30 work?",
    outcome: "continue",
  });
  const { calls, store } = fixture(t);
  const a = await started(calls);
  calls.gather(a.id, 0, { ...callback, SpeechResult: "What time?" });
  await calls.close();
  const text = store.get<any>("call-turn", `${a.id}:1`).text;
  assert.match(text, /between 10 am and 11:30 am on 5 November 2030/);
  assert.ok(text.split(/\s+/).length < 35);
});

test("flexible windows reject invalid, overlapping, excessive or out-of-envelope periods", () => {
  for (const windows of [
    [],
    Array(15).fill(booking.window),
    [booking.window, booking.window],
    [{ start: booking.window.end, end: booking.window.start }],
    [{ start: "2030-11-05T09:00:00Z", end: booking.window.end }],
  ]) {
    assert.equal(
      bookingSchema.safeParse({ ...booking, windows }).success,
      false,
    );
  }
  assert.equal(bookingSchema.safeParse(booking).success, true);
});

test("flexible days preserve later slots and exclude gaps and Calendar conflicts", async (t) => {
  const { calls } = fixture(t, true, {
    ...calendar,
    async busy() {
      return [{ start: "2030-11-07T14:00:00Z", end: "2030-11-07T15:00:00Z" }];
    },
  });
  const windows = [
    { start: "2030-11-05T00:00:00Z", end: "2030-11-06T23:00:00Z" },
    { start: "2030-11-07T13:00:00Z", end: "2030-11-07T17:00:00Z" },
  ];
  const proposal = (
    await calls.prepare(randomUUID(), {
      ...booking,
      window: {
        start: windows[0].start,
        end: windows[1].end,
      },
      windows,
    })
  ).callAction!;
  const a = calls.get(proposal.sessionId, proposal.id);
  assert.ok(a.slots.length > 100);
  assert.equal(a.slots.at(-1)!.start, "2030-11-07T16:30:00.000Z");
  assert.ok(
    a.slots.every((slot) =>
      windows.some(
        (w) =>
          slot.start >= new Date(w.start).toISOString() &&
          slot.end <= new Date(w.end).toISOString(),
      ),
    ),
  );
  const ranges = startTimeRanges(
    a.slots.filter((slot) => slot.start.startsWith("2030-11-07")),
    booking.timeZone,
  );
  assert.deepEqual(ranges, [
    "between 1 pm and 1:30 pm on 7 November 2030",
    "between 3 pm and 4:30 pm on 7 November 2030",
  ]);
});

test("numeric and spoken enumerations become safe ranges while chosen times and goodbyes survive", () => {
  const slots = ["13:00", "13:15", "13:30", "15:00", "15:15"].map((time) => ({
    start: `2030-11-05T${time}:00Z`,
    end: new Date(
      Date.parse(`2030-11-05T${time}:00Z`) + 30 * 60000,
    ).toISOString(),
  }));
  for (const text of [
    "Would 1 pm, 1:15 pm or 1:30 pm work?",
    "Would 1 pm or 1:15 pm work?",
    "We have availability at one, one fifteen, one thirty or three pm.",
    "Could we do one pm, two pm or three pm?",
  ]) {
    assert.equal(
      conciseTimeOffer(text, slots, booking.timeZone),
      "Do you have anything between 1 pm and 1:30 pm on 5 November 2030?",
    );
  }
  for (const text of [
    "Could you confirm Alex for 5 November at 1:15 pm?",
    "Would 1:15 pm work?",
    "None of those times work. Goodbye.",
  ]) {
    assert.equal(conciseTimeOffer(text, slots, booking.timeZone), text);
  }
});

test("overly broad availability is rejected explicitly rather than truncated", async (t) => {
  const { calls } = fixture(t);
  await assert.rejects(
    calls.prepare(randomUUID(), {
      ...booking,
      window: {
        start: "2030-11-01T00:00:00Z",
        end: "2030-11-30T23:00:00Z",
      },
    }),
    /narrow the allowed days or hours/,
  );
});

test("booking planner receives authoritative saved preferences with current-request precedence", async (t) => {
  const memory = {
    id: randomUUID(),
    title: "Haircut preferences",
    text: "Salon, Alex, 30 minutes, weekdays after 2 pm",
    updatedAt: Date.now(),
  };
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: any) => {
    const request = JSON.parse(init.body);
    const instructions = request.messages[0].content;
    assert.ok(instructions.includes(JSON.stringify([memory])));
    assert.match(
      instructions,
      /The current request overrides saved preferences/,
    );
    assert.match(instructions, /Never guess missing fields/);
    assert.match(instructions, /book me a haircut/);
    assert.match(instructions, /a separate approval remains required/);
    assert.match(
      instructions,
      /do not substitute an email draft, reminder or Calendar event/,
    );
    assert.match(instructions, /Never include excluded periods in windows/);
    assert.match(request.messages.at(-1).content, /Thursday/);
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              kind: "clarify",
              text: "Which phone number should I call?",
            }),
          },
        },
      ],
    });
  });
  await new MetaPlanner(config).plan(
    [{ role: "user", content: "Call my barber on Thursday instead." }],
    booking.timeZone,
    { memories: [memory] },
  );
});

test("short appointments cannot merge across unavailable gaps", () => {
  assert.deepEqual(
    startTimeRanges(
      [
        { start: "2030-11-05T13:00:00Z", end: "2030-11-05T13:05:00Z" },
        { start: "2030-11-05T13:15:00Z", end: "2030-11-05T13:20:00Z" },
      ],
      "Europe/London",
    ),
    ["at 1 pm on 5 November 2030", "at 1:15 pm on 5 November 2030"],
  );
});

test("brief introduction discloses AI and a newly connected Calendar is checked before dialing", async (t) => {
  const counts = providers(t);
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  let connected = false;
  let reads = 0;
  const calls = new Calls(
    config,
    store,
    {
      ...calendar,
      async busy() {
        reads++;
        return [{ start: booking.window.start, end: "2030-11-05T11:00:00Z" }];
      },
    },
    () => connected,
  );
  t.after(async () => {
    await calls.close();
    store.close();
  });
  const proposal = (await calls.prepare(randomUUID(), booking)).callAction!;
  assert.equal(proposal.calendarChecked, false);
  connected = true;
  await calls.decide(proposal.sessionId, proposal.id, "confirm");
  const action = calls.get(proposal.sessionId, proposal.id);
  assert.equal(action.calendarChecked, true);
  assert.equal(reads, 1);
  assert.equal(action.slots[0].start, "2030-11-05T11:00:00.000Z");
  assert.equal(counts.dial, 1);
  const intro = store.get<any>("call-turn", `${action.id}:0`).text;
  assert.match(intro, /Tuck, Alex’s AI assistant/);
  assert.match(intro, /Is it okay to chat/);
  assert.ok(intro.split(/\s+/).length <= 30);
});

test("large call proposals keep internal candidates off the client wire", async (t) => {
  const { calls } = fixture(t);
  const result = await calls.prepare(randomUUID(), {
    ...booking,
    window: { start: "2030-11-05T00:00:00Z", end: "2030-11-15T00:00:00Z" },
  });
  const a = result.callAction!;
  assert.ok(calls.get(a.sessionId, a.id).slots.length > 900);
  assert.deepEqual(a.slots, []);
  assert.deepEqual(calls.publicAction(calls.get(a.sessionId, a.id)).slots, []);
  assert.ok(
    Buffer.byteLength(JSON.stringify({ type: "result", result })) < 65536,
  );
});

test("background calls survive chat and report only actual progress through completion", async (t) => {
  providers(t);
  let context: unknown;
  let plannerCalls = 0;
  const built = await buildApp(config, {
    calendar,
    planner: {
      async plan(_messages, _zone, options) {
        plannerCalls++;
        context = options?.latestCall;
        return { kind: "reply", text: "Hello there." };
      },
      async transcribe() {
        return "";
      },
    },
  });
  t.after(() => built.app.close());
  const session = built.service.createSession("Europe/London");
  const other = built.service.createSession("Europe/London");
  const ask = (text: string) =>
    built.service.turn(session.id, randomUUID(), { text });
  assert.match(
    (await ask("How is my booking going?")).speechText,
    /haven’t started/,
  );
  assert.equal(plannerCalls, 0);
  const a = (await built.calls.prepare(session.id, booking)).callAction!;
  await ask("Hello");
  assert.equal(built.calls.get(session.id, a.id).status, "pending");
  await built.calls.decide(session.id, a.id, "confirm");
  assert.match(
    (await ask("How is my booking going?")).speechText,
    /waiting for it to connect/,
  );
  assert.equal(plannerCalls, 1);
  assert.equal(built.calls.get(session.id, a.id).progress?.stage, "queued");
  built.calls.status(a.id, {
    ...callback,
    SequenceNumber: "0",
    CallStatus: "ringing",
  });
  assert.match((await ask("How is my booking going?")).speechText, /ringing/);
  built.calls.status(a.id, {
    ...callback,
    SequenceNumber: "1",
    CallStatus: "in-progress",
  });
  await ask("Tell me something fun");
  assert.equal(built.calls.get(session.id, a.id).status, "in_progress");
  assert.deepEqual(context, {
    id: a.id,
    status: "in_progress",
    progress: "The call is connected. No booking is confirmed yet.",
    summary: undefined,
    destinationName: "Salon",
  });
  assert.match((await ask("Did they answer?")).speechText, /connected/);
  assert.equal(plannerCalls, 2);
  built.calls.status(a.id, {
    ...callback,
    SequenceNumber: "0",
    CallStatus: "ringing",
  });
  assert.equal(
    built.calls.get(session.id, a.id).progress?.stage,
    "in_conversation",
  );
  assert.throws(
    () =>
      built.calls.status(a.id, {
        ...callback,
        SequenceNumber: "9",
        CallStatus: "invented",
      }),
    /Invalid call status/,
  );
  built.calls.status(a.id, {
    ...callback,
    SequenceNumber: "2",
    CallStatus: "completed",
  });
  const final = await ask("Is my call done?");
  assert.match(final.speechText, /without a confirmed booking/);
  assert.equal(final.callAction?.progress, undefined);
  built.calls.status(a.id, {
    ...callback,
    SequenceNumber: "3",
    CallStatus: "in-progress",
  });
  assert.equal(built.calls.get(session.id, a.id).status, "completed");
  const headers = { authorization: `Bearer ${config.API_TOKEN}` };
  assert.equal(
    (await built.app.inject(`/v1/sessions/${session.id}/calls`)).statusCode,
    401,
  );
  assert.deepEqual(
    (
      await built.app.inject({ url: `/v1/sessions/${other.id}/calls`, headers })
    ).json(),
    { calls: [] },
  );
  assert.equal(
    (
      await built.app.inject({
        url: `/v1/sessions/${other.id}/calls/${a.id}`,
        headers,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await built.app.inject({
        url: `/v1/sessions/${session.id}/calls`,
        headers,
      })
    ).json().calls[0].id,
    a.id,
  );
});

test("one global active call is claimed before any preparation await and restart remains blocked", async (t) => {
  const counts = providers(t);
  const { calls, store } = fixture(t);
  const a = (await calls.prepare(randomUUID(), booking)).callAction!;
  const b = (await calls.prepare(randomUUID(), booking)).callAction!;
  const first = calls.decide(a.sessionId, a.id, "confirm");
  await assert.rejects(
    calls.decide(b.sessionId, b.id, "confirm"),
    /already active or unverified/,
  );
  await assert.rejects(
    calls.prepare(randomUUID(), booking),
    /already active or unverified/,
  );
  await first;
  assert.equal(counts.dial, 1);
  const restarted = new Calls(config, store, calendar, () => false);
  assert.equal(restarted.get(a.sessionId, a.id).status, "uncertain");
  assert.equal(
    restarted.publicAction(restarted.get(a.sessionId, a.id)).progress,
    undefined,
  );
  await assert.rejects(
    restarted.decide(b.sessionId, b.id, "confirm"),
    /already active or unverified/,
  );
  assert.equal(counts.dial, 1);
});

test("confirmed summary includes localized appointment and separate Calendar truth", async (t) => {
  const { calls, store } = fixture(t);
  const a = (await calls.prepare(randomUUID(), booking)).callAction!;
  const stored = calls.get(a.sessionId, a.id);
  stored.status = "completed";
  stored.outcome = "booked";
  stored.bookedSlot = stored.slots[0];
  store.put("call", a.id, stored);
  assert.match(
    calls.statusReply(a.sessionId).speechText,
    /5 November 2030.*10:00/,
  );
  assert.match(
    calls.statusReply(a.sessionId).speechText,
    /not been saved to Calendar/,
  );
  assert.equal(store.list("action").length, 0);
  stored.calendarActionId = randomUUID();
  store.put("call", a.id, stored);
  store.put("action", stored.calendarActionId, { status: "pending" });
  assert.match(
    calls.statusReply(a.sessionId).speechText,
    /not been saved to Calendar/,
  );
  store.put("action", stored.calendarActionId, { status: "completed" });
  assert.match(calls.statusReply(a.sessionId).speechText, /Saved to Calendar/);
});

test("overdue active progress is factual without changing durable state or redialing", async (t) => {
  const { calls, store } = fixture(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No provider request is allowed");
  });
  const prepared = (await calls.prepare(randomUUID(), booking)).callAction!;
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  for (const [status, stage] of [
    ["starting", "starting"],
    ["queued", "queued"],
    ["queued", "ringing"],
    ["in_progress", "in_conversation"],
  ] as const) {
    const a = calls.get(prepared.sessionId, prepared.id);
    a.status = status;
    a.startedAt = now - 6 * 60000;
    a.progress = { stage, text: "Last verified progress." };
    store.put("call", a.id, a);
    assert.equal(calls.publicAction(a).progress?.stage, stage);
    a.startedAt--;
    store.put("call", a.id, a);
    const before = calls.get(a.sessionId, a.id);
    assert.equal(calls.publicAction(a).progress?.stage, "awaiting_update");
    assert.equal(calls.list(a.sessionId)[0].progress?.stage, "awaiting_update");
    assert.match(
      calls.result(a).speechText,
      /haven’t received a final call update/,
    );
    assert.equal(calls.result(a).statusText, "call update overdue");
    assert.match(
      calls.statusReply(a.sessionId).speechText,
      /haven’t received a final call update/,
    );
    assert.deepEqual(calls.get(a.sessionId, a.id), before);
    await assert.rejects(
      calls.prepare(randomUUID(), booking),
      /already active or unverified/,
    );
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("true terminal transitions persist one completion time in public lists", async (t) => {
  for (const status of [
    "completed",
    "failed",
    "cancelled",
    "expired",
    "stopped",
  ] as const) {
    await t.test(status, async (t) => {
      providers(t);
      const { calls, store } = fixture(t);
      let now = Date.now();
      t.mock.method(Date, "now", () => now);
      const a =
        status === "cancelled" || status === "expired"
          ? (await calls.prepare(randomUUID(), booking)).callAction!
          : await started(calls);
      assert.equal(a.finishedAt, undefined);
      if (status === "expired") {
        now = a.expiresAt + 1;
        calls.get(a.sessionId, a.id);
      } else if (status === "cancelled") {
        await calls.decide(a.sessionId, a.id, "cancel");
      } else if (status === "stopped") {
        await calls.stop(a.sessionId, a.id);
      } else {
        calls.status(a.id, {
          ...callback,
          CallStatus: status,
          SequenceNumber: "1",
        });
      }
      const finishedAt = now;
      assert.equal(store.get<CallAction>("call", a.id)?.finishedAt, finishedAt);
      assert.equal(calls.list(a.sessionId)[0].finishedAt, finishedAt);
      now += 3600000;
      if (status === "completed" || status === "failed") {
        calls.status(a.id, {
          ...callback,
          CallStatus: status,
          SequenceNumber: "2",
        });
      } else {
        await calls.stop(a.sessionId, a.id);
      }
      assert.equal(calls.get(a.sessionId, a.id).finishedAt, finishedAt);
      assert.equal(calls.list(a.sessionId)[0].finishedAt, finishedAt);
    });
  }
});

test("calendar links preserve completion time and do not date legacy completions", async (t) => {
  providers(t);
  const { calls, store } = fixture(t, true);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const a = await started(calls);
  const booked = calls.get(a.sessionId, a.id);
  booked.outcome = "booked";
  booked.bookedSlot = booked.slots[0];
  store.put("call", a.id, booked);
  calls.status(a.id, {
    ...callback,
    CallStatus: "completed",
    SequenceNumber: "1",
  });
  const finishedAt = now;
  now += 3600000;
  assert.equal(
    calls.proposeCalendar(a.sessionId, a.id).callAction?.finishedAt,
    finishedAt,
  );
  assert.equal(calls.list(a.sessionId)[0].finishedAt, finishedAt);

  const legacy = { ...calls.get(a.sessionId, a.id), id: randomUUID() };
  delete legacy.finishedAt;
  delete legacy.calendarActionId;
  store.put("call", legacy.id, legacy);
  assert.equal(
    calls.proposeCalendar(legacy.sessionId, legacy.id).callAction?.finishedAt,
    undefined,
  );
  assert.equal(store.get<CallAction>("call", legacy.id)?.finishedAt, undefined);
  assert.equal(
    calls.list(legacy.sessionId).find((a) => a.id === legacy.id)?.finishedAt,
    undefined,
  );
});

test("uncertain calls remain undated until a verified stop", async (t) => {
  providers(t);
  const { calls, store } = fixture(t);
  const a = await started(calls);
  const recovered = new Calls(config, store, calendar, () => false);
  assert.equal(recovered.get(a.sessionId, a.id).status, "uncertain");
  assert.equal(recovered.list(a.sessionId)[0].finishedAt, undefined);
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  assert.equal(
    (await recovered.stop(a.sessionId, a.id)).callAction?.finishedAt,
    now,
  );
  await recovered.close();
});

async function confirmedSource(calls: Calls, store: Store) {
  const proposal = (await calls.prepare(randomUUID(), booking)).callAction!;
  const source = calls.get(proposal.sessionId, proposal.id);
  source.status = "completed";
  source.outcome = "booked";
  source.bookedSlot = source.slots[0];
  store.put("call", source.id, source);
  return source;
}

test("booking change proposals bind the original details, require approval and deduplicate retries", async (t) => {
  const counts = providers(t);
  const { calls, store } = fixture(t);
  const source = await confirmedSource(calls, store);
  const change = {
    operation: "reschedule" as const,
    window: { start: "2030-11-06T10:00:00Z", end: "2030-11-06T12:00:00Z" },
  };
  const first = (await calls.prepareChange(source.sessionId, source.id, change))
    .callAction!;
  assert.equal(first.operation, "reschedule");
  assert.equal(first.sourceCallId, source.id);
  assert.deepEqual(first.originalSlot, source.bookedSlot);
  assert.equal(first.booking.phoneNumber, source.booking.phoneNumber);
  assert.equal(first.status, "pending");
  assert.equal(counts.dial, 0);
  const second = (
    await calls.prepareChange(source.sessionId, source.id, change)
  ).callAction!;
  assert.equal(second.id, first.id);
  await assert.rejects(
    calls.prepareChange(source.sessionId, source.id, {
      operation: "cancel_booking",
    }),
    /existing change request/,
  );
  await calls.decide(first.sessionId, first.id, "cancel");
  assert.equal(calls.get(source.sessionId, source.id).supersededBy, undefined);
  assert.equal(counts.dial, 0);
});

test("unverified, past and cross-session bookings cannot be changed", async (t) => {
  const { calls, store } = fixture(t);
  const source = await confirmedSource(calls, store);
  await assert.rejects(
    calls.prepareChange(randomUUID(), source.id, {
      operation: "cancel_booking",
    }),
    /not found/,
  );
  await assert.rejects(
    calls.prepareChange(source.sessionId, source.id, {
      operation: "reschedule",
    }),
    /window/i,
  );
  source.outcome = "not_booked";
  store.put("call", source.id, source);
  await assert.rejects(
    calls.prepareChange(source.sessionId, source.id, {
      operation: "cancel_booking",
    }),
    /confirmed booking/,
  );
  source.outcome = "booked";
  source.bookedSlot = {
    start: "2020-01-01T10:00:00Z",
    end: "2020-01-01T10:30:00Z",
  };
  store.put("call", source.id, source);
  await assert.rejects(
    calls.prepareChange(source.sessionId, source.id, {
      operation: "cancel_booking",
    }),
    /future bookings/,
  );
});

test("verified cancellation requires separate call and Calendar approvals", async (t) => {
  const speech = "Alex's appointment on 5 November at 10:00 is cancelled.";
  const counts = providers(t, {
    text: "Thank you, goodbye.",
    outcome: "booking_cancelled",
    confirmationQuote: speech,
  });
  const { calls, store } = fixture(t, true);
  const source = await confirmedSource(calls, store);
  const saved = calls.proposeCalendar(source.sessionId, source.id).action!;
  saved.status = "completed";
  saved.receipt = {
    id: saved.id.replaceAll("-", ""),
    title: saved.event.title,
    start: saved.event.start,
    end: saved.event.end,
    simulated: false,
  };
  store.put("action", saved.id, saved);
  const proposal = (
    await calls.prepareChange(source.sessionId, source.id, {
      operation: "cancel_booking",
    })
  ).callAction!;
  assert.equal(counts.dial, 0);
  await calls.decide(proposal.sessionId, proposal.id, "confirm");
  assert.equal(counts.dial, 1);
  calls.voice(proposal.id, 0, callback);
  calls.gather(proposal.id, 0, { ...callback, SpeechResult: speech });
  await calls.close();
  calls.voice(proposal.id, 1, callback);
  const completed = calls.get(proposal.sessionId, proposal.id);
  assert.equal(completed.outcome, "booking_cancelled");
  assert.equal(
    calls.get(source.sessionId, source.id).supersededBy,
    proposal.id,
  );
  assert.equal(store.get<any>("action", saved.id).status, "completed");
  const removal = calls.proposeCalendar(
    proposal.sessionId,
    proposal.id,
  ).action!;
  assert.equal(removal.operation, "delete");
  assert.equal(removal.status, "pending");
  assert.deepEqual(removal.targetReceipt, saved.receipt);
  assert.equal(removal.sourceActionId, saved.id);
  await assert.rejects(
    calls.prepareChange(source.sessionId, source.id, {
      operation: "cancel_booking",
    }),
    /current, confirmed/,
  );
});

test("ambiguous cancellation does not change booking or allow Calendar removal", async (t) => {
  const speech = "Can Alex's appointment on 5 November at 10:00 be cancelled?";
  providers(t, {
    text: "It is cancelled.",
    outcome: "booking_cancelled",
    confirmationQuote: speech,
  });
  const { calls, store } = fixture(t);
  const source = await confirmedSource(calls, store);
  const proposal = (
    await calls.prepareChange(source.sessionId, source.id, {
      operation: "cancel_booking",
    })
  ).callAction!;
  await calls.decide(proposal.sessionId, proposal.id, "confirm");
  calls.gather(proposal.id, 0, { ...callback, SpeechResult: speech });
  await calls.close();
  assert.match(calls.voice(proposal.id, 1, callback), /Gather/);
  assert.equal(calls.get(source.sessionId, source.id).supersededBy, undefined);
  assert.throws(
    () => calls.proposeCalendar(proposal.sessionId, proposal.id),
    /No confirmed/,
  );
});

test("verified reschedule preserves original evidence and proposes updating the linked event", async (t) => {
  const speech =
    "Alex's appointment has been rescheduled to 6 November at 10:00.";
  providers(t, {
    text: "Thank you, goodbye.",
    outcome: "rescheduled",
    slotIndex: 0,
    confirmationQuote: speech,
  });
  const { calls, store } = fixture(t, true);
  const source = await confirmedSource(calls, store);
  const saved = calls.proposeCalendar(source.sessionId, source.id).action!;
  saved.status = "completed";
  saved.receipt = {
    id: saved.id.replaceAll("-", ""),
    title: saved.event.title,
    start: saved.event.start,
    end: saved.event.end,
    simulated: false,
  };
  store.put("action", saved.id, saved);
  const proposal = (
    await calls.prepareChange(source.sessionId, source.id, {
      operation: "reschedule",
      window: { start: "2030-11-06T10:00:00Z", end: "2030-11-06T12:00:00Z" },
    })
  ).callAction!;
  await calls.decide(proposal.sessionId, proposal.id, "confirm");
  calls.gather(proposal.id, 0, { ...callback, SpeechResult: speech });
  await calls.close();
  calls.voice(proposal.id, 1, callback);
  assert.equal(
    calls.get(proposal.sessionId, proposal.id).outcome,
    "rescheduled",
  );
  const update = calls.proposeCalendar(proposal.sessionId, proposal.id).action!;
  assert.equal(update.operation, "update");
  assert.equal(update.event.start, "2030-11-06T10:00:00.000Z");
  assert.equal(update.targetReceipt?.start, source.bookedSlot!.start);
  assert.equal(
    store.get<any>("action", saved.id).receipt.start,
    source.bookedSlot!.start,
  );
});

test("task listing and spoken status include another device's active call", async (t) => {
  providers(t);
  const { calls } = fixture(t);
  const call = await started(calls);
  const other = randomUUID();
  const result = calls.statusReply(other);
  assert.equal(result.sessionId, other);
  assert.equal(result.callAction?.id, call.id);
  assert.equal(result.callAction?.sessionId, call.sessionId);
  assert(calls.listAll().some((a) => a.id === call.id));
});

test("chained changes retain the Calendar creation binding and latest verified event", async (t) => {
  const { calls, store } = fixture(t, true);
  const original = await confirmedSource(calls, store);
  const create = calls.proposeCalendar(original.sessionId, original.id).action!;
  create.status = "completed";
  create.receipt = {
    id: create.id.replaceAll("-", ""),
    title: create.event.title,
    start: create.event.start,
    end: create.event.end,
    simulated: false,
  };
  store.put("action", create.id, create);
  const next = (
    await calls.prepareChange(original.sessionId, original.id, {
      operation: "reschedule",
      window: { start: "2030-11-06T10:00:00Z", end: "2030-11-06T12:00:00Z" },
    })
  ).callAction!;
  let rescheduled = calls.get(next.sessionId, next.id);
  rescheduled.status = "completed";
  rescheduled.outcome = "rescheduled";
  rescheduled.bookedSlot = rescheduled.slots[0];
  store.put("call", rescheduled.id, rescheduled);
  const update = calls.proposeCalendar(
    rescheduled.sessionId,
    rescheduled.id,
  ).action!;
  update.status = "completed";
  update.receipt = {
    ...create.receipt,
    start: update.event.start,
    end: update.event.end,
  };
  store.put("action", update.id, update);
  const cancelled = (
    await calls.prepareChange(rescheduled.sessionId, rescheduled.id, {
      operation: "cancel_booking",
    })
  ).callAction!;
  const cancellation = calls.get(cancelled.sessionId, cancelled.id);
  cancellation.status = "completed";
  cancellation.outcome = "booking_cancelled";
  store.put("call", cancellation.id, cancellation);
  const removal = calls.proposeCalendar(
    cancellation.sessionId,
    cancellation.id,
  ).action!;
  assert.equal(removal.sourceActionId, create.id);
  assert.deepEqual(removal.targetReceipt, update.receipt);
  assert.equal(removal.operation, "delete");
});

test("cancellation after an unsaved reschedule still targets the original saved Calendar event", async (t) => {
  const { calls, store } = fixture(t, true);
  const original = await confirmedSource(calls, store);
  const create = calls.proposeCalendar(original.sessionId, original.id).action!;
  create.status = "completed";
  create.receipt = {
    id: create.id.replaceAll("-", ""),
    title: create.event.title,
    start: create.event.start,
    end: create.event.end,
    simulated: false,
  };
  store.put("action", create.id, create);
  const next = (
    await calls.prepareChange(original.sessionId, original.id, {
      operation: "reschedule",
      window: { start: "2030-11-06T10:00:00Z", end: "2030-11-06T12:00:00Z" },
    })
  ).callAction!;
  const moved = calls.get(next.sessionId, next.id);
  moved.status = "completed";
  moved.outcome = "rescheduled";
  moved.bookedSlot = moved.slots[0];
  store.put("call", moved.id, moved);
  const cancelled = (
    await calls.prepareChange(moved.sessionId, moved.id, {
      operation: "cancel_booking",
    })
  ).callAction!;
  const cancellation = calls.get(cancelled.sessionId, cancelled.id);
  cancellation.status = "completed";
  cancellation.outcome = "booking_cancelled";
  store.put("call", cancellation.id, cancellation);
  const removal = calls.proposeCalendar(
    cancellation.sessionId,
    cancellation.id,
  ).action!;
  assert.equal(removal.sourceActionId, create.id);
  assert.deepEqual(removal.targetReceipt, create.receipt);
});

test("cross-device voice booking changes keep the requesting conversation and original action session", async (t) => {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  let sourceId = "";
  const built = await buildApp(config, {
    store,
    calendar,
    planner: {
      async plan() {
        return {
          kind: "change_booking",
          callId: sourceId,
          change: { operation: "cancel_booking" },
        };
      },
      async transcribe() {
        return "";
      },
    },
  });
  t.after(() => built.app.close());
  const watch = built.service.createSession("Europe/London");
  const phone = built.service.createSession("Europe/London");
  const proposal = (await built.calls.prepare(watch.id, booking)).callAction!;
  const source = built.calls.get(watch.id, proposal.id);
  source.status = "completed";
  source.outcome = "booked";
  source.bookedSlot = source.slots[0];
  store.put("call", source.id, source);
  sourceId = source.id;
  const result = await built.service.turn(phone.id, randomUUID(), {
    text: "Call to cancel my confirmed booking",
  });
  assert.equal(result.sessionId, phone.id);
  assert.equal(result.callAction?.sessionId, watch.id);
  assert.equal(result.callAction?.sourceCallId, source.id);
  assert.equal(result.callAction?.status, "pending");
});

for (const operation of ["book", "reschedule", "cancel_booking"] as const) {
  test(`${operation} accepts confirmed May dates and customer Will`, async (t) => {
    const outcome =
      operation === "book"
        ? "booked"
        : operation === "reschedule"
          ? "rescheduled"
          : "booking_cancelled";
    const day = operation === "reschedule" ? 6 : 5;
    const speech =
      operation === "reschedule"
        ? "Will's appointment has been rescheduled to 6 May at 10:00."
        : `Will's appointment on ${day} May at 10:00 is ${operation === "book" ? "booked" : "cancelled"}.`;
    providers(t, {
      text: "Thank you, goodbye.",
      outcome,
      confirmationQuote: speech,
      ...(operation !== "cancel_booking" ? { slotIndex: 0 } : {}),
    });
    const { calls, store } = fixture(t);
    const original = (
      await calls.prepare(randomUUID(), {
        ...booking,
        customerName: "Will",
        window: { start: "2030-05-05T09:00:00Z", end: "2030-05-05T11:00:00Z" },
      })
    ).callAction!;
    let proposal = original;
    if (operation !== "book") {
      const source = calls.get(original.sessionId, original.id);
      source.status = "completed";
      source.outcome = "booked";
      source.bookedSlot = source.slots[0];
      store.put("call", source.id, source);
      proposal = (
        await calls.prepareChange(
          source.sessionId,
          source.id,
          operation === "cancel_booking"
            ? { operation }
            : {
                operation,
                window: {
                  start: "2030-05-06T09:00:00Z",
                  end: "2030-05-06T11:00:00Z",
                },
              },
        )
      ).callAction!;
    }
    await calls.decide(proposal.sessionId, proposal.id, "confirm");
    calls.gather(proposal.id, 0, { ...callback, SpeechResult: speech });
    await calls.close();
    calls.voice(proposal.id, 1, callback);
    assert.equal(calls.get(proposal.sessionId, proposal.id).outcome, outcome);
  });
}

test("confirmation grammar rejects future and hypothetical outcomes without treating names/months as verbs", () => {
  for (const quote of [
    "It will be booked for Will on 5 May at 10:00",
    "It may be cancelled",
    "It could be moved",
    "It is booked if you pay",
    "Can it be booked?",
    "We will confirm tomorrow",
  ])
    assert.equal(isConditionalConfirmation(quote), true, quote);
  for (const quote of [
    "Will is booked on 5 May at 10:00",
    "Will's appointment has been cancelled",
    "I can confirm Will is booked on 5 May at 10:00",
  ])
    assert.equal(isConditionalConfirmation(quote), false, quote);
});

test("rescheduling excludes the verified original event at proposal and rechecks all other conflicts before dialing", async (t) => {
  const counts = providers(t);
  let checks = 0,
    conflict = false;
  const { calls, store } = fixture(t, true, {
    ...calendar,
    async busyExcluding(window, sourceId, target) {
      checks++;
      assert.equal(target.id, sourceId.replaceAll("-", ""));
      assert.equal(target.start, "2030-11-05T10:00:00.000Z");
      return conflict
        ? [{ start: "2030-11-05T10:20:00Z", end: "2030-11-05T10:40:00Z" }]
        : [];
    },
  });
  const original = await confirmedSource(calls, store);
  const saved = calls.proposeCalendar(original.sessionId, original.id).action!;
  saved.status = "completed";
  saved.receipt = {
    id: saved.id.replaceAll("-", ""),
    title: saved.event.title,
    start: saved.event.start,
    end: saved.event.end,
    simulated: false,
  };
  store.put("action", saved.id, saved);
  const proposal = (
    await calls.prepareChange(original.sessionId, original.id, {
      operation: "reschedule",
      window: { start: "2030-11-05T10:15:00Z", end: "2030-11-05T10:45:00Z" },
    })
  ).callAction!;
  assert.equal(
    calls.get(proposal.sessionId, proposal.id).slots[0].start,
    "2030-11-05T10:15:00.000Z",
  );
  assert.equal(checks, 1);
  conflict = true;
  const result = await calls.decide(proposal.sessionId, proposal.id, "confirm");
  assert.equal(checks, 2);
  assert.equal(result.callAction?.status, "failed");
  assert.equal(counts.dial, 0);
});
