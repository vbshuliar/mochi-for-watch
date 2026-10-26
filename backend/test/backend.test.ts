import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { MockCalendar } from "../src/calendar.ts";
import { AppError, type Planner, validateWav } from "../src/domain.ts";
process.env.NODE_ENV = "test";
const config = () =>
  readConfig({
    API_TOKEN: "a".repeat(64),
    ENCRYPTION_KEY: "b".repeat(64),
    DATABASE_PATH: ":memory:",
  });
async function fixture(overrides: Parameters<typeof buildApp>[1] = {}) {
  const built = await buildApp(config(), overrides);
  const headers = { authorization: "Bearer " + "a".repeat(64) };
  const request = async (method: string, url: string, payload?: unknown) =>
    built.app.inject({
      method: method as "POST",
      url,
      headers,
      payload: payload as any,
    });
  const create = async () =>
    (
      await request("POST", "/v1/sessions", { timeZone: "Europe/London" })
    ).json().id as string;
  const turn = async (
    id: string,
    text = "schedule demo lunch",
    requestId = randomUUID(),
  ) => request("POST", `/v1/sessions/${id}/turns`, { text, requestId });
  const decision = async (id: string, action: string, value = "confirm") =>
    request("POST", `/v1/sessions/${id}/actions/${action}/decision`, {
      decision: value,
    });
  return { ...built, request, create, turn, decision };
}
test("auth, input validation, health and truthful mode", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  assert.equal((await f.app.inject("/v1/status")).statusCode, 401);
  assert.equal((await f.app.inject("/health")).statusCode, 200);
  assert.equal((await f.request("GET", "/v1/status")).json().mode, "mock");
  assert.equal(
    (await f.request("POST", "/v1/sessions", { timeZone: "invalid" }))
      .statusCode,
    400,
  );
});
test("proposal does not write; confirmation writes once and gives idle transition", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create(),
    proposal = (await f.turn(id)).json();
  assert.equal(proposal.state, "approval");
  assert.equal(f.store.list("mock_event").length, 0);
  const done = (await f.decision(id, proposal.action.id)).json();
  assert.equal(done.state, "happy");
  assert.equal(done.simulated, true);
  assert.deepEqual(done.returnTo, { state: "idle", afterMs: 2400 });
  const again = (await f.decision(id, proposal.action.id)).json();
  assert.equal(done.data.id, again.data.id);
  assert.equal(f.store.list("mock_event").length, 1);
});
test("turn retries reuse proposal and reject changed content", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create(),
    key = randomUUID();
  const a = (await f.turn(id, "schedule demo lunch", key)).json();
  const b = (await f.turn(id, "schedule demo lunch", key)).json();
  assert.equal(a.action.id, b.action.id);
  assert.equal((await f.turn(id, "different", key)).statusCode, 409);
});
test("cancel and expired approvals cannot execute", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create(),
    a = (await f.turn(id)).json().action;
  await f.decision(id, a.id, "cancel");
  assert.equal((await f.decision(id, a.id)).statusCode, 409);
  const b = (await f.turn(id)).json().action;
  f.store.put("action", b.id, { ...b, expiresAt: 0 });
  assert.equal((await f.decision(id, b.id)).statusCode, 409);
  assert.equal(f.store.list("mock_event").length, 0);
});
test("other sessions cannot confirm a proposal; new request supersedes old proposal", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create(),
    other = await f.create(),
    a = (await f.turn(id)).json().action;
  assert.equal((await f.decision(other, a.id)).statusCode, 404);
  await f.turn(id, "hello");
  assert.equal((await f.decision(id, a.id)).statusCode, 409);
});
test("clarification retains context without a write", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create();
  assert.equal((await f.turn(id, "lunch")).json().state, "clarify");
  assert.equal(
    (await f.turn(id, "tomorrow at 1 pm for one hour")).json().state,
    "approval",
  );
  assert.equal(f.service.session(id).messages.length, 4);
  assert.equal(f.store.list("mock_event").length, 0);
});
test("invalid model plan cannot execute arbitrary tools", async (t) => {
  const planner = {
    plan: async () => ({ kind: "shell", command: "bad" }),
    transcribe: async () => "",
  } as unknown as Planner;
  const f = await fixture({ planner });
  t.after(() => f.app.close());
  const id = await f.create();
  assert.equal((await f.turn(id)).statusCode, 400);
  assert.equal(f.store.list("action").length, 0);
});
test("uncertain save is recoverable without duplicate and cannot be cancelled or deleted", async (t) => {
  const store = new Store(":memory:", "b".repeat(64)),
    mock = new MockCalendar(store);
  let first = true;
  const calendar = {
    list: mock.list.bind(mock),
    busy: mock.busy.bind(mock),
    create: async (id: string, event: any) => {
      const result = await mock.create(id, event);
      if (first) {
        first = false;
        throw new AppError(502, "timeout", "timeout");
      }
      return result;
    },
  };
  const f = await fixture({ store, calendar });
  t.after(() => f.app.close());
  const id = await f.create(),
    a = (await f.turn(id)).json().action;
  assert.equal((await f.decision(id, a.id)).statusCode, 502);
  assert.equal(f.service.action(id, a.id).status, "uncertain");
  assert.equal((await f.decision(id, a.id, "cancel")).statusCode, 409);
  assert.equal(
    (await f.request("DELETE", `/v1/sessions/${id}`)).statusCode,
    409,
  );
  assert.equal((await f.decision(id, a.id)).json().state, "happy");
  assert.equal(store.list("mock_event").length, 1);
});
test("simultaneous confirmation is serialized", async (t) => {
  const store = new Store(":memory:", "b".repeat(64)),
    mock = new MockCalendar(store);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const calendar = {
    list: mock.list.bind(mock),
    busy: mock.busy.bind(mock),
    create: async (id: string, event: any) => {
      entered();
      await gate;
      return mock.create(id, event);
    },
  };
  const f = await fixture({ store, calendar });
  t.after(() => f.app.close());
  const id = await f.create(),
    a = (await f.turn(id)).json().action;
  const pending = f.decision(id, a.id);
  await started;
  const second = await f.decision(id, a.id);
  assert.equal(second.statusCode, 409);
  release();
  assert.equal((await pending).statusCode, 200);
  assert.equal(store.list("mock_event").length, 1);
});
function wav(seconds = 1) {
  const size = 16000 * 2 * seconds,
    b = Buffer.alloc(44 + size);
  b.write("RIFF");
  b.writeUInt32LE(36 + size, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(size, 40);
  return b;
}
test("WAV validation rejects junk and long audio", () => {
  assert.doesNotThrow(() => validateWav(wav()));
  assert.throws(() => validateWav(Buffer.from("bad")));
  assert.throws(() => validateWav(wav(61)));
  const stereo = wav();
  stereo.writeUInt16LE(2, 22);
  assert.throws(() => validateWav(stereo));
});
test("audio endpoint runs transcription, never persists raw audio", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create();
  const response = await f.app.inject({
    method: "POST",
    url: `/v1/sessions/${id}/audio`,
    headers: {
      authorization: "Bearer " + "a".repeat(64),
      "content-type": "audio/wav",
      "idempotency-key": randomUUID(),
    },
    payload: wav(),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().state, "approval");
  assert(f.service.events(id).some((e) => e.state === "transcribe"));
  assert.equal(f.store.list("audio").length, 0);
});
test("read tools return simulated receipts and busy periods", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create(),
    a = (await f.turn(id)).json().action;
  await f.decision(id, a.id);
  assert.equal((await f.turn(id, "list demo events")).json().data.length, 1);
  assert.equal(
    (await f.turn(id, "check demo availability")).json().data.busy.length,
    1,
  );
});
test("session deletion removes local history but not external event", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create(),
    a = (await f.turn(id)).json().action;
  await f.decision(id, a.id);
  assert.equal(
    (await f.request("DELETE", `/v1/sessions/${id}`)).statusCode,
    204,
  );
  assert.equal(f.store.list("turn").length, 0);
  assert.equal(f.store.list("action").length, 0);
  assert.equal(f.store.list("mock_event").length, 1);
  assert.equal(
    (await f.request("GET", `/v1/sessions/${id}/events`)).statusCode,
    404,
  );
});
test("storage survives restart and encrypts private values", () => {
  const dir = mkdtempSync(join(tmpdir(), "muse-test-")),
    path = join(dir, "db.sqlite");
  try {
    const a = new Store(path, "b".repeat(64));
    a.put("secret", "test", { value: "private-token-example" });
    a.close();
    assert(!readFileSync(path).includes(Buffer.from("private-token-example")));
    const b = new Store(path, "b".repeat(64));
    assert.deepEqual(b.get("secret", "test"), {
      value: "private-token-example",
    });
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("mode switching on a shared database fails closed", async () => {
  const store = new Store(":memory:", "b".repeat(64));
  store.put("config", "mode", "live");
  await assert.rejects(buildApp(config(), { store }), /separate DATABASE_PATH/);
});

test("Calendar switch blocks new tasks and pending saves without losing proposals", async (t) => {
  const f = await fixture();
  t.after(() => f.app.close());
  const id = await f.create();
  const proposal = (await f.turn(id)).json();
  assert.equal(
    (await f.request("PATCH", "/v1/integrations/google", { enabled: false }))
      .statusCode,
    200,
  );
  assert.equal(
    (await f.request("GET", "/v1/status")).json().calendarEnabled,
    false,
  );
  assert.equal((await f.turn(id)).json().error.code, "calendar_disabled");
  assert.equal(
    (await f.decision(id, proposal.action.id)).json().error.code,
    "calendar_disabled",
  );
  assert.equal(f.store.list("mock_event").length, 0);
  assert.equal(
    f.store.get<{ status: string }>("action", proposal.action.id)?.status,
    "pending",
  );
  await f.request("PATCH", "/v1/integrations/google", { enabled: true });
  assert.equal(
    (await f.decision(id, proposal.action.id)).json().state,
    "happy",
  );
  assert.equal(
    (await f.request("PATCH", "/v1/integrations/google", { enabled: "yes" }))
      .statusCode,
    400,
  );
});
