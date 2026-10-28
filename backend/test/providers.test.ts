import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { GoogleCalendar } from "../src/calendar.ts";
import { MetaPlanner } from "../src/meta.ts";
import { Service } from "../src/service.ts";
import { MockPlanner } from "../src/meta.ts";
import { MockCalendar } from "../src/calendar.ts";
const config = () =>
  readConfig({
    API_TOKEN: "a".repeat(64),
    ENCRYPTION_KEY: "b".repeat(64),
    MODEL_API_KEY: "test-key",
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    DATABASE_PATH: ":memory:",
  });
const event = {
  title: "Lunch",
  start: "2030-10-27T13:00:00Z",
  end: "2030-10-27T14:00:00Z",
  timeZone: "Europe/London",
};
function setup(t: any) {
  const store = new Store(":memory:", "b".repeat(64));
  t.after(() => store.close());
  const calendar = new GoogleCalendar(config(), store);
  return { store, calendar };
}
function mockFetch(t: any, fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("OAuth uses both required scopes, PKCE and single-use expiring state", async (t) => {
  const { store, calendar } = setup(t);
  const url = new URL(calendar.authorizationUrl());
  assert(url.searchParams.get("scope")!.includes("calendar.events.freebusy"));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  await assert.rejects(calendar.callback("wrong", "code"));
  const state = url.searchParams.get("state")!;
  mockFetch(t, async (_url, init) => {
    assert((init!.body as URLSearchParams).get("code_verifier"));
    return json({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      scope: url.searchParams.get("scope"),
    });
  });
  await calendar.callback(state, "code");
  assert(calendar.connected());
  assert(!store.get("oauth", "pending"));
  await assert.rejects(calendar.callback(state, "code"));
  calendar.disconnect();
  assert(!calendar.connected());
});
test("partial OAuth grants are rejected", async (t) => {
  const { calendar } = setup(t);
  const url = new URL(calendar.authorizationUrl());
  mockFetch(t, async () =>
    json({
      access_token: "a",
      refresh_token: "r",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/calendar.events.owned",
    }),
  );
  await assert.rejects(
    calendar.callback(url.searchParams.get("state")!, "code"),
  );
  assert(!calendar.connected());
});
test("Google insert supplies deterministic ID, then verifies read receipt", async (t) => {
  const { store, calendar } = setup(t);
  store.put("secret", "google", {
    access: "access",
    expiresAt: Date.now() + 3600000,
  });
  const id = randomUUID(),
    eventId = id.replaceAll("-", "");
  let created: any,
    posts = 0;
  mockFetch(t, async (url, init) => {
    assert.equal(
      new Headers(init!.headers).get("Authorization"),
      "Bearer access",
    );
    if (init?.method === "POST") {
      posts++;
      created = JSON.parse(init.body as string);
      assert.equal(created.id, eventId);
      return json(created);
    }
    return created ? json({ ...created, status: "confirmed" }) : json({}, 404);
  });
  const first = await calendar.create(id, event);
  assert.equal(first.id, eventId);
  assert.equal(first.simulated, false);
  await calendar.create(id, event);
  assert.equal(posts, 1);
});
test("Google mismatch is not reported as success", async (t) => {
  const { store, calendar } = setup(t);
  store.put("secret", "google", {
    access: "access",
    expiresAt: Date.now() + 3600000,
  });
  mockFetch(t, async () =>
    json({
      id: "wrong",
      summary: "Wrong",
      start: { dateTime: event.start },
      end: { dateTime: event.end },
    }),
  );
  await assert.rejects(calendar.create(randomUUID(), event), /differs/);
});
test("Google freebusy errors never become an empty free calendar", async (t) => {
  const { store, calendar } = setup(t);
  store.put("secret", "google", {
    access: "access",
    expiresAt: Date.now() + 3600000,
  });
  mockFetch(t, async () =>
    json({ calendars: { primary: { errors: [{ reason: "notFound" }] } } }),
  );
  await assert.rejects(
    calendar.busy({ start: event.start, end: event.end }),
    /availability/,
  );
});
test("Google refresh failure removes expired credentials", async (t) => {
  const { store, calendar } = setup(t);
  store.put("secret", "google", {
    access: "old",
    refresh: "refresh",
    expiresAt: 0,
  });
  mockFetch(t, async () => json({ error: "invalid_grant" }, 400));
  await assert.rejects(
    calendar.list({ start: event.start, end: event.end }),
    /reconnect/,
  );
  assert(!calendar.connected());
});
test("Meta chat adapter sends context and accepts validated plan", async (t) => {
  const planner = new MetaPlanner(config());
  mockFetch(t, async (url, init) => {
    assert(String(url).endsWith("/chat/completions"));
    const body = JSON.parse(init!.body as string);
    assert.equal(body.messages[0].role, "developer");
    assert.equal(body.reasoning_effort, "low");
    assert(body.messages[0].content.includes("You are Jolly"));
    assert(body.messages[0].content.includes("Europe/London"));
    return json({
      choices: [
        {
          message: { content: JSON.stringify({ kind: "create_event", event }) },
          finish_reason: "stop",
        },
      ],
    });
  });
  assert.equal(
    (await planner.plan([{ role: "user", content: "lunch" }], "Europe/London"))
      .kind,
    "create_event",
  );
});
test("Meta malformed and truncated plans fail closed", async (t) => {
  const planner = new MetaPlanner(config());
  mockFetch(t, async () =>
    json({
      choices: [{ message: { content: "bad" }, finish_reason: "length" }],
    }),
  );
  await assert.rejects(
    planner.plan([{ role: "user", content: "hello" }], "UTC"),
  );
});
test("Meta transcription uses documented multipart fields and plain text", async (t) => {
  const planner = new MetaPlanner(config());
  mockFetch(t, async (url, init) => {
    assert(String(url).endsWith("/asr/transcribe"));
    assert.equal(new Headers(init!.headers).get("Accept"), "text/plain");
    const form = init!.body as FormData;
    assert(form.get("audio") instanceof Blob);
    const settings = JSON.parse(await (form.get("request") as Blob).text());
    assert.equal(settings.mode, "PUSH_TO_TALK");
    assert.equal(settings.audioEncoding, "WAV");
    return new Response("hello there");
  });
  assert.equal(await planner.transcribe(Buffer.from("fixture")), "hello there");
});
test("restart marks executing actions uncertain for explicit recovery", (t) => {
  const { store } = setup(t),
    id = randomUUID();
  store.put("action", id, {
    id,
    sessionId: randomUUID(),
    event,
    status: "executing",
    expiresAt: 0,
  });
  new Service(store, new MockPlanner(), new MockCalendar(store), true);
  assert.equal(store.get<any>("action", id).status, "uncertain");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function authorization(calendar: GoogleCalendar) {
  const url = new URL(calendar.authorizationUrl());
  return {
    state: url.searchParams.get("state")!,
    response: (access = "new", expires_in = 3600) =>
      json({
        access_token: access,
        refresh_token: `${access}-refresh`,
        expires_in,
        scope: url.searchParams.get("scope"),
      }),
  };
}
for (const replace of [false, true]) {
  test(`delayed Calendar callback cannot restore ${replace ? "superseded" : "disconnected"} authorization`, async (t) => {
    const { calendar, store } = setup(t);
    const first = authorization(calendar);
    const response = deferred<Response>();
    mockFetch(t, async () => response.promise);
    const callback = calendar.callback(first.state, "code");
    const rejected = assert.rejects(callback, { code: "connection_changed" });
    await assert.rejects(calendar.callback(first.state, "replay"), {
      code: "invalid_oauth_state",
    });
    calendar.disconnect();
    const next = replace ? authorization(calendar) : undefined;
    response.resolve(first.response("old"));
    await rejected;
    assert.equal(calendar.connected(), false);
    assert.equal(
      store.get<{ state: string }>("oauth", "pending")?.state,
      next?.state,
    );
  });
}
for (const status of [200, 400]) {
  test(`stale Calendar refresh (${status}) cannot alter a reconnected account or supply its token`, async (t) => {
    const { calendar, store } = setup(t);
    store.put("secret", "google", {
      access: "old",
      refresh: "old-refresh",
      expiresAt: 0,
    });
    const oldRefresh = deferred<Response>();
    let newRefreshes = 0;
    let auth: ReturnType<typeof authorization>;
    mockFetch(t, async (url, init) => {
      if (String(url).includes("oauth2")) {
        const body = init!.body as URLSearchParams;
        if (body.get("grant_type") === "authorization_code")
          return auth.response("new", 1);
        if (body.get("refresh_token") === "old-refresh")
          return oldRefresh.promise;
        assert.equal(body.get("refresh_token"), "new-refresh");
        newRefreshes++;
        return json({ access_token: "new-fresh", expires_in: 3600 });
      }
      assert.equal(
        new Headers(init!.headers).get("Authorization"),
        "Bearer new-fresh",
      );
      return json({ items: [] });
    });
    const oldRequest = calendar.list(event);
    const rejected = assert.rejects(oldRequest, { code: "connection_changed" });
    calendar.disconnect();
    auth = authorization(calendar);
    await calendar.callback(auth.state, "new-code");
    await calendar.list(event);
    assert.equal(newRefreshes, 1);
    oldRefresh.resolve(
      json({ access_token: "stale", expires_in: 3600 }, status),
    );
    await rejected;
    assert.equal(
      store.get<{ access: string }>("secret", "google")?.access,
      "new-fresh",
    );
    await calendar.list(event);
  });
}
test("failed Calendar refresh preserves a pending reconnect", async (t) => {
  const { calendar, store } = setup(t);
  store.put("secret", "google", {
    access: "old",
    refresh: "old-refresh",
    expiresAt: 0,
  });
  const pending = authorization(calendar);
  mockFetch(t, async () => json({}, 400));
  await assert.rejects(calendar.list(event), { code: "calendar_disconnected" });
  assert.equal(
    store.get<{ state: string }>("oauth", "pending")?.state,
    pending.state,
  );
});
for (const operation of ["create", "list", "busy"] as const) {
  test(`Calendar ${operation} stops when the account changes during its provider request`, async (t) => {
    const { calendar, store } = setup(t);
    store.put("secret", "google", {
      access: "old",
      expiresAt: Date.now() + 3600000,
    });
    const first = deferred<Response>();
    const started = deferred<void>();
    let requests = 0;
    let auth: ReturnType<typeof authorization>;
    mockFetch(t, async (url) => {
      if (String(url).includes("oauth2")) return auth.response();
      requests++;
      started.resolve();
      return first.promise;
    });
    const pending =
      operation === "create"
        ? calendar.create(randomUUID(), event)
        : calendar[operation](event);
    const rejected = assert.rejects(pending, { code: "connection_changed" });
    await started.promise;
    auth = authorization(calendar);
    await calendar.callback(auth.state, "code");
    first.resolve(
      operation === "create"
        ? json({}, 404)
        : operation === "list"
          ? json({ items: [], nextPageToken: "page2" })
          : json({ calendars: { primary: { busy: [] } } }),
    );
    await rejected;
    assert.equal(requests, 1);
    assert.equal(
      store.get<{ access: string }>("secret", "google")?.access,
      "new",
    );
  });
}

test("uncertain Calendar writes cannot be retried on a different account after adapter restart", async (t) => {
  const { calendar, store } = setup(t);
  store.put("secret", "google", {
    access: "old",
    expiresAt: Date.now() + 3600000,
  });
  const id = randomUUID();
  let posts = 0;
  let calendarRequests = 0;
  let auth: ReturnType<typeof authorization>;
  mockFetch(t, async (url, init) => {
    if (String(url).includes("oauth2")) return auth.response();
    calendarRequests++;
    if (init?.method === "POST") {
      posts++;
      // The provider could have saved the event before the connection failed.
      throw new Error("response lost");
    }
    return json({}, 404);
  });
  await assert.rejects(calendar.create(id, event), {
    code: "provider_unavailable",
  });
  assert.equal(posts, 1);
  auth = authorization(calendar);
  await calendar.callback(auth.state, "new-code");
  const restarted = new GoogleCalendar(config(), store);
  await assert.rejects(restarted.create(id, event), {
    code: "connection_changed",
  });
  assert.equal(calendarRequests, 2);
  assert.equal(posts, 1);
});
