import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { Connection } from "../src/connections.ts";
import { GmailDrafts } from "../src/gmail-drafts.ts";
const read = "https://www.googleapis.com/auth/gmail.readonly";
const compose = "https://www.googleapis.com/auth/gmail.compose";
const config = readConfig({
  APP_MODE: "live",
  MODEL_API_KEY: "fake",
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  GOOGLE_CLIENT_ID: "g",
  GOOGLE_CLIENT_SECRET: "s",
});
const input = {
  to: "recipient@example.com",
  subject: "Résumé ✂️ ".repeat(10).trim(),
  body: "Hello 👋\nСпасибо\nBest, Vlad",
};
function fixture(t: TestContext, drafts = true) {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  t.after(() => store.close());
  store.put("secret", "gmail", {
    access: "test",
    refresh: "refresh",
    epoch: "epoch",
    expiresAt: Date.now() + 3600000,
    scopes: drafts ? [read, compose] : [read],
    draftsEnabled: drafts,
  });
  const gmail = new Connection("gmail", config, store);
  return {
    store,
    gmail,
    service: new GmailDrafts(config, store, gmail),
    session: randomUUID(),
  };
}
test("draft permission is opt-in and OAuth validates granted scopes", async (t) => {
  const { gmail } = fixture(t, false);
  assert.equal(new URL(gmail.authorize()).searchParams.get("scope"), read);
  let url = new URL(gmail.authorize({ drafts: true }));
  assert.equal(url.searchParams.get("scope"), `${read} ${compose}`);
  let scope = read;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      access_token: "new",
      refresh_token: "refresh",
      expires_in: 3600,
      scope,
    }),
  );
  await assert.rejects(
    gmail.callback(url.searchParams.get("state")!, "code"),
    /Allow Gmail/,
  );
  scope = `${read} ${compose}`;
  url = new URL(gmail.authorize({ drafts: true }));
  await gmail.callback(url.searchParams.get("state")!, "code");
  assert.equal(gmail.canDraft(), true);
  url = new URL(gmail.authorize());
  await gmail.callback(url.searchParams.get("state")!, "code");
  assert.equal(gmail.canDraft(), false);
});
test("transport forbids sending or modifying messages and keeps readonly reads", async (t) => {
  const { gmail } = fixture(t, false);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({});
  });
  for (const path of ["messages/send", "drafts/send", "drafts"])
    await assert.rejects(gmail.request(path, { method: "POST" }));
  await assert.rejects(gmail.request("drafts/x", { method: "DELETE" }));
  assert.equal(requests, 0);
  await gmail.request("messages");
  assert.equal(requests, 1);
});
test("local review is bounded, session-bound, idempotent and cancellation never writes", async (t) => {
  const { service, session, store } = fixture(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw Error("unexpected");
  });
  for (const invalid of [
    { ...input, to: "a@b.com\r\nBcc: x@y.com" },
    { ...input, subject: "hello\nBcc: x@y.com" },
    { ...input, cc: "other@example.com" },
    { ...input, body: "x".repeat(8001) },
  ])
    assert.throws(() => service.prepare(session, invalid));
  const action = service.prepare(session, input);
  assert.equal(service.prepare(session, input).id, action.id);
  assert.equal("epoch" in action, false);
  assert.equal("messageId" in action, false);
  assert.throws(() => service.get(randomUUID(), action.id));
  await assert.rejects(service.decide(randomUUID(), action.id, "confirm"));
  assert.equal(
    (await service.decide(session, action.id, "cancel")).status,
    "cancelled",
  );
  await assert.rejects(service.decide(session, action.id, "confirm"));
  const expired = service.prepare(session, input);
  const saved = store.get<Record<string, unknown>>(
    "gmail_draft_action",
    expired.id,
  )!;
  saved.expiresAt = 1;
  store.put("gmail_draft_action", expired.id, saved);
  await assert.rejects(service.decide(session, expired.id, "confirm"));
  assert.equal(requests, 0);
});
test("confirm creates once and verifies exact Unicode MIME draft", async (t) => {
  const { service, session } = fixture(t);
  let raw = "";
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("profile"))
      return Response.json({ emailAddress: "owner@example.com" });
    if (init.method === "POST") {
      writes++;
      raw = JSON.parse(String(init.body)).message.raw;
      return Response.json({ id: "draft1" });
    }
    return Response.json({
      id: "draft1",
      message: { raw, labelIds: ["DRAFT"] },
    });
  });
  const action = service.prepare(session, input);
  const result = await service.decide(session, action.id, "confirm");
  assert.equal(result.status, "completed");
  assert.equal(result.draftId, "draft1");
  assert.match(
    Buffer.from(raw, "base64url").toString(),
    /Content-Transfer-Encoding: base64/,
  );
  assert.equal(
    (await service.decide(session, action.id, "confirm")).status,
    "completed",
  );
  assert.equal(writes, 1);
});
test("ambiguous save survives restart and reconciles exact Message-ID without retry", async (t) => {
  const { service, store, gmail, session } = fixture(t);
  let raw = "";
  let writes = 0;
  let found = false;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("profile"))
      return Response.json({ emailAddress: "owner@example.com" });
    if (init.method === "POST") {
      writes++;
      raw = JSON.parse(String(init.body)).message.raw;
      throw Error("timeout after provider saved");
    }
    if (url.includes("drafts?")) {
      assert.match(new URL(url).searchParams.get("q")!, /^rfc822msgid:<jolly-/);
      return Response.json({ drafts: found ? [{ id: "recovered" }] : [] });
    }
    return Response.json({ id: "recovered", message: { raw } });
  });
  const action = service.prepare(session, input);
  await assert.rejects(service.decide(session, action.id, "confirm"));
  const restarted = new GmailDrafts(config, store, gmail);
  assert.equal(restarted.get(session, action.id).status, "uncertain");
  assert.throws(() => restarted.prepare(session, input));
  assert.throws(() => restarted.deleteSession(session));
  await assert.rejects(restarted.decide(session, action.id, "cancel"));
  await assert.rejects(restarted.decide(session, action.id, "confirm"));
  assert.equal(writes, 1);
  found = true;
  assert.equal(
    (await restarted.decide(session, action.id, "confirm")).status,
    "completed",
  );
  assert.equal(writes, 1);
});
test("concurrent confirmations cannot duplicate drafts and mismatched readback is uncertain", async (t) => {
  const { service, session } = fixture(t);
  let writes = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("profile")) {
      await blocked;
      return Response.json({ emailAddress: "owner@example.com" });
    }
    if (init.method === "POST") {
      writes++;
      return Response.json({ id: "draft1" });
    }
    return Response.json({
      id: "draft1",
      message: {
        raw: Buffer.from("To: intruder@example.com\r\n\r\nwrong").toString(
          "base64url",
        ),
      },
    });
  });
  const action = service.prepare(session, input);
  const saving = service.decide(session, action.id, "confirm");
  await assert.rejects(
    service.decide(session, action.id, "confirm"),
    /already being saved/,
  );
  release();
  await assert.rejects(saving, /could not be verified/);
  await assert.rejects(service.decide(session, action.id, "confirm"));
  assert.equal(writes, 1);
  assert.equal(service.get(session, action.id).status, "uncertain");
});
test("mock mode and readonly accounts cannot propose drafts", (t) => {
  const { service, store, gmail, session } = fixture(t, false);
  assert.throws(() => service.prepare(session, input), /Enable Gmail/);
  assert.throws(
    () =>
      new GmailDrafts({ ...config, APP_MODE: "mock" }, store, gmail).prepare(
        session,
        input,
      ),
    /live mode/,
  );
});
test("refresh losing compose permission cannot create a draft", async (t) => {
  const { gmail, store } = fixture(t);
  const token = store.get<Record<string, unknown>>("secret", "gmail")!;
  token.expiresAt = 1;
  store.put("secret", "gmail", token);
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.includes("oauth2.googleapis.com"))
      return Response.json({
        access_token: "new",
        expires_in: 3600,
        scope: read,
      });
    writes++;
    return Response.json({ id: "unexpected" });
  });
  await assert.rejects(
    gmail.request("drafts", { method: "POST", body: "{}" }),
    /no longer available/,
  );
  assert.equal(writes, 0);
  assert.equal(gmail.canDraft(), false);
});
test("account changes during saving never claim success or write to the new account", async (t) => {
  const { service, session, store } = fixture(t);
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("profile"))
      return Response.json({ emailAddress: "owner@example.com" });
    if (init.method === "POST") {
      writes++;
      const token = store.get<Record<string, unknown>>("secret", "gmail")!;
      token.epoch = "different-account";
      store.put("secret", "gmail", token);
      return Response.json({ id: "saved-in-original" });
    }
    throw Error("unexpected read");
  });
  const action = service.prepare(session, input);
  await assert.rejects(
    service.decide(session, action.id, "confirm"),
    /connection changed/i,
  );
  await assert.rejects(
    service.decide(session, action.id, "confirm"),
    /connection changed/i,
  );
  assert.equal(service.get(session, action.id).status, "uncertain");
  assert.equal(writes, 1);
});
test("draft POST authentication errors are never automatically replayed", async (t) => {
  const { gmail } = fixture(t);
  let writes = 0;
  t.mock.method(globalThis, "fetch", async () => {
    writes++;
    return new Response(null, { status: 401 });
  });
  assert.equal(
    (await gmail.request("drafts", { method: "POST", body: "{}" })).status,
    401,
  );
  assert.equal(writes, 1);
});
