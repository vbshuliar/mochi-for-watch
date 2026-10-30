import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.ts";
import { Calls } from "../src/calls.ts";
import { Store } from "../src/store.ts";
import { readConfig } from "../src/config.ts";
import {
  bookingSchema,
  contactLookupResponseSchema,
  type Planner,
  type Plan,
  type PlanOptions,
  type Calendar,
} from "../src/domain.ts";
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
const request = {
  destinationName: "Sam",
  phoneNumber: "+442012345679",
  purpose: "tell Sam I will arrive at 6 pm",
  customerName: "Alex",
  timeZone: "Europe/London",
};
const contact = {
  displayName: "Sam",
  phoneNumber: request.phoneNumber,
  phoneLabel: "mobile",
};
async function fixture(t: any) {
  let plan: Plan = { kind: "lookup_contact", query: "Sam" };
  let options: PlanOptions | undefined;
  let plans = 0;
  const planner: Planner = {
    transcribe: async () => "call Sam",
    plan: async (_m, _tz, o) => {
      options = o;
      plans++;
      return plan;
    },
  };
  const f = await buildApp(config, { planner });
  t.after(() => f.app.close());
  const id = f.service.createSession("Europe/London").id;
  return {
    ...f,
    id,
    setPlan: (p: Plan) => {
      plan = p;
    },
    options: () => options,
    plans: () => plans,
    lookup: () =>
      f.service.turn(
        id,
        randomUUID(),
        { text: "Call Sam and tell them I will arrive at 6 pm" },
        { contactLookupSupported: true },
      ),
  };
}
test("selected local contact continues with approval only, idempotent replay and conflict protection", async (t) => {
  const f = await fixture(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("No external operations allowed");
  });
  const lookup = (await f.lookup()).contactLookup!;
  f.setPlan({ kind: "call_delegate", request });
  const response = {
    requestId: randomUUID(),
    status: "selected" as const,
    contact,
  };
  const result = await f.service.continueContactLookup(
    f.id,
    lookup.id,
    response,
  );
  assert.equal(result.callAction?.operation, "conversation");
  assert.equal(result.callAction?.status, "pending");
  assert.equal(result.callAction?.booking.window, undefined);
  assert.equal(result.callAction?.booking.durationMinutes, undefined);
  assert.equal(result.callAction?.calendarChecked, false);
  assert.deepEqual(f.options()?.selectedContact, contact);
  assert.equal(f.store.list("call-attempt").length, 0);
  assert.deepEqual(
    await f.service.continueContactLookup(f.id, lookup.id, response),
    JSON.parse(JSON.stringify(result)),
  );
  await assert.rejects(
    f.service.continueContactLookup(f.id, lookup.id, {
      ...response,
      contact: { ...contact, phoneNumber: "+442012345680" },
    }),
    /new request ID/,
  );
  await assert.rejects(
    f.service.continueContactLookup(f.id, lookup.id, {
      ...response,
      requestId: randomUUID(),
    }),
    /already has a response/,
  );
  // Selected records are not recovered from past assistant proposals.
  await assert.rejects(
    f.service.turn(f.id, randomUUID(), { text: "call them again" }),
    /provide the destination phone/,
  );
});
test("contact authority survives clarification but expires and never crosses sessions", async (t) => {
  const f = await fixture(t),
    lookup = (await f.lookup()).contactLookup!;
  const other = f.service.createSession("Europe/London").id;
  await assert.rejects(
    f.service.continueContactLookup(other, lookup.id, {
      requestId: randomUUID(),
      status: "selected",
      contact,
    }),
    /not found/,
  );
  f.setPlan({ kind: "clarify", text: "What name should I give?" });
  await f.service.continueContactLookup(f.id, lookup.id, {
    requestId: randomUUID(),
    status: "selected",
    contact,
  });
  f.setPlan({ kind: "call_delegate", request });
  const result = await f.service.turn(f.id, randomUUID(), { text: "Alex" });
  assert.equal(result.callAction?.booking.phoneNumber, contact.phoneNumber);
  f.setPlan({ kind: "lookup_contact", query: "Sam" });
  const second = (await f.lookup()).contactLookup!;
  f.setPlan({ kind: "clarify", text: "What name should I give?" });
  await f.service.continueContactLookup(f.id, second.id, {
    requestId: randomUUID(),
    status: "selected",
    contact,
  });
  const session = f.service.session(f.id);
  session.selectedContact!.expiresAt = 0;
  f.store.put("session", f.id, session);
  f.setPlan({ kind: "call_delegate", request });
  await assert.rejects(
    f.service.turn(f.id, randomUUID(), { text: "Alex" }),
    /provide the destination phone/,
  );
});
test("superseded and expired selections reject; denial and unsupported lookup are honest and bounded", async (t) => {
  const f = await fixture(t);
  const unsupported = await f.service.turn(f.id, randomUUID(), {
    text: "call Sam",
  });
  assert.equal(unsupported.contactLookup, undefined);
  assert.match(unsupported.speechText, /iPhone/);
  const stale = (await f.lookup()).contactLookup!;
  const newer = (await f.lookup()).contactLookup!;
  await assert.rejects(
    f.service.continueContactLookup(f.id, stale.id, {
      requestId: randomUUID(),
      status: "selected",
      contact,
    }),
    /expired or was superseded/,
  );
  const row = f.store.get<any>("contact-lookup", newer.id);
  row.expiresAt = 0;
  f.store.put("contact-lookup", newer.id, row);
  await assert.rejects(
    f.service.continueContactLookup(f.id, newer.id, {
      requestId: randomUUID(),
      status: "selected",
      contact,
    }),
    /expired or was superseded/,
  );
  for (const status of [
    "denied",
    "not_found",
    "unavailable",
    "cancelled",
  ] as const) {
    const lookup = (await f.lookup()).contactLookup!,
      count = f.plans();
    const result = await f.service.continueContactLookup(f.id, lookup.id, {
      requestId: randomUUID(),
      status,
    });
    assert.equal(f.plans(), count);
    assert.equal(result.contactLookup, undefined);
    assert.equal(result.callAction, undefined);
  }
  assert.throws(() =>
    contactLookupResponseSchema.parse({
      requestId: randomUUID(),
      status: "denied",
      contact,
    }),
  );
  assert.throws(() =>
    contactLookupResponseSchema.parse({
      requestId: randomUUID(),
      status: "selected",
    }),
  );
  await f.service.deleteSession(f.id);
  assert.equal(f.store.list("contact-lookup").length, 0);
});
test("authenticated endpoint accepts only the selected record and text capability flag", async (t) => {
  const f = await fixture(t),
    headers = { authorization: `Bearer ${config.API_TOKEN}` };
  const turn = await f.app.inject({
    method: "POST",
    url: `/v1/sessions/${f.id}/turns`,
    headers,
    payload: {
      requestId: randomUUID(),
      text: "call Sam",
      contactLookupSupported: true,
    },
  });
  assert.equal(turn.statusCode, 200, turn.body);
  const lookup = turn.json().contactLookup;
  const url = `/v1/sessions/${f.id}/contact-lookups/${lookup.id}`;
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url,
        payload: { requestId: randomUUID(), status: "cancelled" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url,
        headers,
        payload: {
          requestId: randomUUID(),
          status: "selected",
          contact,
          candidates: [contact],
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url,
        headers,
        payload: { requestId: randomUUID(), status: "cancelled" },
      })
    ).statusCode,
    200,
  );
});
const sid = "CA" + "c".repeat(32);
const callback = { AccountSid: config.TWILIO_ACCOUNT_SID, CallSid: sid };
function callsFixture(t: any, model: unknown) {
  const store = new Store(":memory:", config.ENCRYPTION_KEY),
    settings = { ...config };
  const calendar: Calendar = {
    busy: async () => {
      throw Error("No calendar read");
    },
    list: async () => {
      throw Error("No calendar read");
    },
    create: async () => {
      throw Error("No calendar write");
    },
  };
  const calls = new Calls(settings, store, calendar, () => true);
  let dial = 0;
  const spoken: string[] = [];
  let prompt = "";
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    if (String(url).includes("elevenlabs")) {
      spoken.push(JSON.parse(init.body).text);
      return new Response(Buffer.from("mp3"), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    }
    if (String(url).includes("api.meta.ai")) {
      prompt = JSON.parse(init.body).messages[0].content;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify(
                prompt.includes("FIRST TASK DISCLOSURE:")
                  ? {
                      text: "Alex wanted you to know they will arrive at 6 pm.",
                      outcome: "continue",
                    }
                  : model,
              ),
            },
          },
        ],
      });
    }
    if (String(url).endsWith("Calls.json")) {
      dial++;
      return Response.json({ sid });
    }
    throw Error("Unexpected provider operation");
  });
  t.after(async () => {
    await calls.close();
    store.close();
  });
  return {
    calls,
    store,
    settings,
    spoken,
    dial: () => dial,
    prompt: () => prompt,
  };
}
async function speak(
  f: ReturnType<typeof callsFixture>,
  id: string,
  n: number,
  text: string,
) {
  f.calls.gather(id, n, { ...callback, SpeechResult: text });
  await f.calls.close();
  return f.calls.voice(id, n + 1, callback);
}
test("general approval skips Calendar and slots, dials once, and verifies identity before revealing task", async (t) => {
  const f = callsFixture(t, {
    text: "Thank you, goodbye.",
    outcome: "completed_request",
    confirmationQuote: "I received the message.",
  });
  const a = f.calls.prepareConversation(randomUUID(), request).callAction!;
  assert.throws(() => bookingSchema.parse(request));
  assert.equal(a.followUp?.canRetry, false);
  assert.equal(a.followUp?.canChange, false);
  await Promise.all([
    f.calls.decide(a.sessionId, a.id, "confirm"),
    f.calls.decide(a.sessionId, a.id, "confirm"),
  ]);
  assert.equal(f.dial(), 1);
  assert.match(f.spoken[0], /AI assistant/);
  assert.match(f.spoken[0], /Sam/);
  assert.doesNotMatch(f.spoken[0], /6 pm/);
  f.calls.voice(a.id, 0, callback);
  await speak(f, a.id, 0, "Yes, Sam speaking, go ahead.");
  assert.equal(
    f.spoken[1],
    "Alex wanted you to know they will arrive at 6 pm.",
  );
  assert.match(f.prompt(), /resolve I\/my/);
  assert.equal(f.calls.get(a.sessionId, a.id).outcome, undefined);
  await speak(f, a.id, 1, "I received the message.");
  const result = f.calls.get(a.sessionId, a.id);
  assert.equal(result.outcome, "completed_request");
  assert.equal(result.bookedSlot, undefined);
  assert.match(f.prompt(), /Complete ONLY this approved request/);
  assert.equal(f.store.list("action").length, 0);
  assert.throws(
    () => f.calls.proposeCalendar(a.sessionId, a.id),
    /No confirmed booking/,
  );
  await assert.rejects(
    f.calls.prepareChange(a.sessionId, a.id, { operation: "cancel_booking" }),
    /current, confirmed/,
  );
  await assert.rejects(
    f.calls.prepareRetry(a.sessionId, a.id, {
      window: { start: "2030-11-05T10:00:00Z", end: "2030-11-05T11:00:00Z" },
    }),
    /Check this call/,
  );
});
test("generic approval rechecks allowlist and wrong recipient never receives delegated purpose", async (t) => {
  const f = callsFixture(t, {});
  assert.throws(
    () =>
      f.calls.prepareConversation(randomUUID(), {
        ...request,
        phoneNumber: "+442012345680",
      }),
    /not enabled/,
  );
  const a = f.calls.prepareConversation(randomUUID(), request).callAction!;
  f.settings.TWILIO_ALLOWED_NUMBERS = "+442012345680";
  await assert.rejects(
    f.calls.decide(a.sessionId, a.id, "confirm"),
    /no longer enabled/,
  );
  assert.equal(f.dial(), 0);
  f.settings.TWILIO_ALLOWED_NUMBERS = request.phoneNumber;
  await f.calls.decide(a.sessionId, a.id, "confirm");
  f.calls.voice(a.id, 0, callback);
  await speak(f, a.id, 0, "No, this is not Sam.");
  assert.equal(f.calls.get(a.sessionId, a.id).outcome, "not_completed");
  assert.ok(f.spoken.every((text) => !text.includes("6 pm")));
});
for (const model of [
  {
    text: "All done.",
    outcome: "completed_request",
    confirmationQuote: "I received the message.",
  },
  {
    text: "Booked.",
    outcome: "booked",
    slotIndex: 0,
    confirmationQuote: "confirmed",
  },
])
  test(`generic call rejects fabricated completion or booking outcome ${model.outcome}`, async (t) => {
    const f = callsFixture(t, model),
      a = f.calls.prepareConversation(randomUUID(), request).callAction!;
    await f.calls.decide(a.sessionId, a.id, "confirm");
    f.calls.voice(a.id, 0, callback);
    await speak(f, a.id, 0, "Yes, Sam speaking, go ahead.");
    await speak(f, a.id, 1, "What did you say?");
    assert.equal(f.calls.get(a.sessionId, a.id).outcome, undefined);
    assert.equal(f.store.list("action").length, 0);
  });

for (const speech of [
  "Yes, I can get Sam for you.",
  "Okay, Sam is away.",
  "Yes, Sam is not here.",
  "Yes, I am Sam’s brother.",
])
  test(`third-person identity does not release request: ${speech}`, async (t) => {
    const f = callsFixture(t, {}),
      a = f.calls.prepareConversation(randomUUID(), request).callAction!;
    await f.calls.decide(a.sessionId, a.id, "confirm");
    f.calls.voice(a.id, 0, callback);
    await speak(f, a.id, 0, speech);
    assert.equal(f.calls.get(a.sessionId, a.id).recipientVerified, undefined);
    assert.ok(f.spoken.every((text) => !text.includes("6 pm")));
  });

test("cancelling an in-flight contact continuation removes contact authority and pending proposals", async (t) => {
  let unblock!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>((r) => {
    entered = r;
  });
  const pending = new Promise<void>((r) => {
    unblock = r;
  });
  let phase = 0;
  const planner: Planner = {
    transcribe: async () => "",
    plan: async () => {
      if (phase++ === 0) return { kind: "lookup_contact", query: "Sam" };
      if (phase === 2) {
        entered();
        await pending;
      }
      return { kind: "call_delegate", request };
    },
  };
  const f = await buildApp(config, { planner });
  t.after(() => f.app.close());
  const id = f.service.createSession("Europe/London").id;
  const lookup = (
    await f.service.turn(
      id,
      randomUUID(),
      { text: "Call Sam" },
      { contactLookupSupported: true },
    )
  ).contactLookup!;
  const requestId = randomUUID();
  const continuation = f.service.continueContactLookup(id, lookup.id, {
    requestId,
    status: "selected",
    contact,
  });
  const rejected = assert.rejects(continuation, /request cancelled/);
  await enteredPromise;
  const cancel = f.service.cancelTurn(id, requestId);
  unblock();
  await cancel;
  await rejected;
  assert.equal(f.service.session(id).selectedContact, undefined);
  assert.equal(f.service.session(id).pendingContactLookupId, undefined);
  assert.equal(f.store.list("call").length, 0);
  await assert.rejects(
    f.service.turn(id, randomUUID(), { text: "Alex" }),
    /provide the destination phone/,
  );
});

test("identity gate accepts its requested natural self-identification and explicit consent", async (t) => {
  const f = callsFixture(t, {}),
    a = f.calls.prepareConversation(randomUUID(), request).callAction!;
  await f.calls.decide(a.sessionId, a.id, "confirm");
  f.calls.voice(a.id, 0, callback);
  await speak(
    f,
    a.id,
    0,
    "Yes, I am Sam and it is okay to speak with an AI assistant.",
  );
  assert.equal(f.calls.get(a.sessionId, a.id).recipientVerified, true);
  assert.equal(f.calls.get(a.sessionId, a.id).outcome, undefined);
  assert.equal(
    f.spoken[1],
    "Alex wanted you to know they will arrive at 6 pm.",
  );
});
test("cancel after a completed contact clarification clears only matching authority", async (t) => {
  const f = await fixture(t),
    lookup = (await f.lookup()).contactLookup!;
  f.setPlan({ kind: "clarify", text: "Your name?" });
  const requestId = randomUUID();
  await f.service.continueContactLookup(f.id, lookup.id, {
    requestId,
    status: "selected",
    contact,
  });
  assert.ok(f.service.session(f.id).selectedContact);
  await f.service.cancelTurn(f.id, requestId);
  await assert.rejects(
    f.service.continueContactLookup(f.id, lookup.id, {
      requestId,
      status: "selected",
      contact,
    }),
    /request cancelled/,
  );
  assert.equal(f.service.session(f.id).selectedContact, undefined);
  f.setPlan({ kind: "call_delegate", request });
  await assert.rejects(
    f.service.turn(f.id, randomUUID(), { text: "Alex" }),
    /provide the destination phone/,
  );
});
test("cancelling unrelated chat preserves an existing pending call", async (t) => {
  let phase = 0,
    entered!: () => void,
    unblock!: () => void;
  const enteredPromise = new Promise<void>((r) => {
      entered = r;
    }),
    pending = new Promise<void>((r) => {
      unblock = r;
    });
  const planner: Planner = {
    transcribe: async () => "",
    plan: async () => {
      if (phase++ === 0) return { kind: "call_delegate", request };
      entered();
      await pending;
      return { kind: "reply", text: "hello" };
    },
  };
  const f = await buildApp(config, { planner });
  t.after(() => f.app.close());
  const id = f.service.createSession("Europe/London").id;
  const call = (
    await f.service.turn(id, randomUUID(), {
      text: `Call Sam at ${request.phoneNumber} to tell them I will arrive at 6 pm`,
    })
  ).callAction!;
  const requestId = randomUUID(),
    turn = f.service.turn(id, requestId, { text: "hello" }),
    rejected = assert.rejects(turn, /request cancelled/);
  await enteredPromise;
  const cancel = f.service.cancelTurn(id, requestId);
  unblock();
  await cancel;
  await rejected;
  assert.equal(f.store.get<any>("call", call.id).status, "pending");
});

test("selected contact cannot be replaced by an older saved booking-profile number", async (t) => {
  const f = await fixture(t),
    headers = { authorization: `Bearer ${config.API_TOKEN}` };
  const saved = await f.app.inject({
    method: "PUT",
    url: "/v1/booking-profile",
    headers,
    payload: {
      ...request,
      durationMinutes: 30,
      preferredDays: [1],
      preferredStart: "14:00",
      preferredEnd: "18:00",
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const lookup = (await f.lookup()).contactLookup!;
  f.setPlan({ kind: "call_delegate", request });
  await assert.rejects(
    f.service.continueContactLookup(f.id, lookup.id, {
      requestId: randomUUID(),
      status: "selected",
      contact: { displayName: "New barber", phoneNumber: "+442012345680" },
    }),
    /selected contact/,
  );
  assert.equal(f.store.list("call").length, 0);
});

test("cancel after failed contact continuation clears selected authority and prevents replay", async (t) => {
  const f = await fixture(t),
    lookup = (await f.lookup()).contactLookup!;
  const unavailableContact = { ...contact, phoneNumber: "+442012345680" };
  f.setPlan({
    kind: "call_delegate",
    request: { ...request, phoneNumber: unavailableContact.phoneNumber },
  });
  const requestId = randomUUID(),
    response = {
      requestId,
      status: "selected" as const,
      contact: unavailableContact,
    };
  await assert.rejects(
    f.service.continueContactLookup(f.id, lookup.id, response),
    /not enabled/,
  );
  assert.ok(f.service.session(f.id).selectedContact);
  await f.service.cancelTurn(f.id, requestId);
  assert.equal(f.service.session(f.id).selectedContact, undefined);
  assert.equal(f.service.session(f.id).pendingContactLookupId, undefined);
  await assert.rejects(
    f.service.continueContactLookup(f.id, lookup.id, response),
    /request cancelled/,
  );
  f.setPlan({ kind: "clarify", text: "Your name?" });
  await f.service.turn(f.id, randomUUID(), { text: "hello" });
  assert.equal(f.options()?.selectedContact, undefined);
});

for (const example of [
  { purpose: "ask Sam what time they arrive", speech: "I arrive at 6 pm." },
  { purpose: request.purpose, speech: "Understood, Alex will arrive at 6 pm." },
  {
    purpose: request.purpose,
    speech: "Understood, Alex will be there at 6 pm.",
  },
  {
    purpose: "ask Sam what time they arrive",
    speech: "I will be there at 6 pm.",
  },
  {
    purpose: "ask Sam whether they can attend tomorrow",
    speech: "No, I cannot attend tomorrow.",
  },
])
  test(`conversation receipt preserves the recipient answer: ${example.speech}`, async (t) => {
    const f = callsFixture(t, {
      text: "Thank you, goodbye.",
      outcome: "completed_request",
      confirmationQuote: example.speech,
    });
    const a = f.calls.prepareConversation(randomUUID(), {
      ...request,
      purpose: example.purpose,
    }).callAction!;
    await f.calls.decide(a.sessionId, a.id, "confirm");
    f.calls.voice(a.id, 0, callback);
    await speak(f, a.id, 0, "Yes, Sam speaking, go ahead.");
    await speak(f, a.id, 1, example.speech);
    const saved = f.calls.get(a.sessionId, a.id);
    assert.equal(saved.outcome, "completed_request");
    assert.equal(saved.summary, `Sam said: “${example.speech}”`);
    assert.equal(f.calls.result(saved).speechText, saved.summary);
    assert.equal(f.store.get<any>("call", a.id).summary, saved.summary);
    assert.doesNotMatch(saved.summary!, /go ahead/);
  });
for (const example of [
  {
    purpose: "ask Sam what time they arrive",
    speech: "I will check and let you know.",
  },
  {
    purpose: "ask Sam to send the document",
    speech: "Understood, I will send it tomorrow.",
  },
  { purpose: request.purpose, speech: "I have not received the message." },
])
  test(`a promise or denial does not complete the task: ${example.speech}`, async (t) => {
    const f = callsFixture(t, {
      text: "Thank you.",
      outcome: "completed_request",
      confirmationQuote: example.speech,
    });
    const a = f.calls.prepareConversation(randomUUID(), {
      ...request,
      purpose: example.purpose,
    }).callAction!;
    await f.calls.decide(a.sessionId, a.id, "confirm");
    f.calls.voice(a.id, 0, callback);
    await speak(f, a.id, 0, "Yes, Sam speaking, go ahead.");
    await speak(f, a.id, 1, example.speech);
    assert.equal(f.calls.get(a.sessionId, a.id).outcome, undefined);
  });
