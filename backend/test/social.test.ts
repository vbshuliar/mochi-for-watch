import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { SocialConnections, type SocialProvider } from "../src/social.ts";
const permissions = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "instagram_basic",
  "instagram_manage_comments",
];
const page = {
  id: "123",
  name: "Page",
  access_token: "page-secret",
  instagram_business_account: { id: "456", username: "studio" },
};
function fixture(t: test.TestContext) {
  const store = new Store(":memory:", "a".repeat(64));
  const config = readConfig({
    API_TOKEN: "b".repeat(32),
    ENCRYPTION_KEY: "a".repeat(64),
    META_SOCIAL_APP_ID: "1234",
    META_SOCIAL_APP_SECRET: "secret",
  });
  const social = new SocialConnections(config, store);
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    store.close();
  });
  const replies: unknown[] = [];
  globalThis.fetch = (async (url, init) => {
    assert.equal(new URL(String(url)).origin, "https://graph.facebook.com");
    assert.ok(!String(url).includes("access_token="));
    assert.equal(init?.redirect, "error");
    assert.ok(replies.length, `Unexpected fetch ${url}`);
    return Response.json(replies.shift());
  }) as typeof fetch;
  async function connect(provider: SocialProvider) {
    const state = new URL(social.authorize(provider)).searchParams.get(
      "state",
    )!;
    replies.push(
      { access_token: "user-secret", expires_in: 3600 },
      {
        data: permissions.map((permission) => ({
          permission,
          status: "granted",
        })),
      },
    );
    await social.callback(provider, state, "code");
    return state;
  }
  return { store, social, replies, connect };
}
test("independent grants, selected authorized accounts, no token exposure", async (t) => {
  const { social, replies, connect } = fixture(t);
  await connect("instagram");
  assert.equal(social.status().instagram, "disconnected");
  replies.push({ data: [page] });
  assert.deepEqual(await social.accounts("instagram"), [
    { id: "456", name: "studio" },
  ]);
  replies.push({ data: [page] });
  await assert.rejects(social.select("instagram", "999"), /not authorized/);
  replies.push({ data: [page] });
  await social.select("instagram", "456");
  assert.equal(social.status().instagram, "connected");
  await connect("facebook");
  replies.push({ data: [page] });
  await social.select("facebook", "123");
  social.disconnect("facebook");
  assert.equal(social.status().instagram, "connected");
  assert.equal(social.status().facebook, "disconnected");
  assert.ok(!JSON.stringify(social.status()).includes("secret"));
  replies.push({
    data: [
      {
        id: "777",
        caption: "Hello",
        comments: { data: [{ id: "888", text: "Question" }] },
      },
    ],
  });
  assert.equal(
    (await social.activity("instagram")).posts[0].comments[0].text,
    "Question",
  );
});
test("callback state replay, provider mismatch, denied and expired state", async (t) => {
  const { social, store, connect } = fixture(t);
  const state = await connect("instagram");
  await assert.rejects(social.callback("instagram", state, "code"), /state/);
  const other = new URL(social.authorize("facebook")).searchParams.get(
    "state",
  )!;
  await assert.rejects(social.callback("instagram", other, "code"), /state/);
  const pending = store.get<any>("social-oauth", "facebook");
  store.put("social-oauth", "facebook", { ...pending, expiresAt: 0 });
  await assert.rejects(social.callback("facebook", other, "code"), /expired/);
  await assert.rejects(social.callback("facebook", other, "code"), /state/);
  const denied = new URL(social.authorize("facebook")).searchParams.get(
    "state",
  )!;
  await social.callback("facebook", denied);
  await assert.rejects(social.callback("facebook", denied, "code"), /state/);
});
test("missing permissions and expired access require reconnect", async (t) => {
  const { social, store, replies, connect } = fixture(t);
  const state = new URL(social.authorize("facebook")).searchParams.get(
    "state",
  )!;
  replies.push({ access_token: "secret", expires_in: 1000 }, { data: [] });
  await assert.rejects(
    social.callback("facebook", state, "code"),
    /permissions/,
  );
  await connect("facebook");
  replies.push({ data: [page] });
  await social.select("facebook", "123");
  const grant = store.get<any>("social-grant", "facebook");
  store.put("social-grant", "facebook", { ...grant, expiresAt: 0 });
  assert.equal(social.status().facebook, "disconnected");
  await assert.rejects(social.accounts("facebook"), /reconnect/);
});
test("disconnect during callback cannot resurrect grant", async (t) => {
  const { social } = fixture(t);
  const state = new URL(social.authorize("facebook")).searchParams.get(
    "state",
  )!;
  let release!: () => void;
  let first = true;
  globalThis.fetch = (async () => {
    if (first) {
      first = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json({ access_token: "secret", expires_in: 3600 });
    }
    return Response.json({
      data: permissions.map((permission) => ({
        permission,
        status: "granted",
      })),
    });
  }) as typeof fetch;
  const pending = social.callback("facebook", state, "code");
  social.disconnect("facebook");
  release();
  await assert.rejects(pending, /changed/);
  assert.equal(social.status().facebook, "disconnected");
});
test("disconnect during account selection or activity rejects stale result", async (t) => {
  const { social, replies, connect } = fixture(t);
  await connect("facebook");
  replies.push({ data: [page] });
  await social.select("facebook", "123");
  const revision = social.revision("facebook");
  assert.ok(revision);
  let release!: () => void;
  globalThis.fetch = (async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return Response.json({ data: [{ id: "777", message: "private" }] });
  }) as typeof fetch;
  const pending = social.activity("facebook");
  social.disconnect("facebook");
  release();
  await assert.rejects(pending, /changed/);
  assert.equal(social.revision("facebook"), undefined);
});
test("permission revocation invalidates connected status", async (t) => {
  const { social, replies, connect } = fixture(t);
  await connect("facebook");
  replies.push({ data: [page] });
  await social.select("facebook", "123");
  replies.push({ error: { code: 190, message: "SECRET PROVIDER DETAILS" } });
  await assert.rejects(social.activity("facebook"), /reconnect/);
  assert.equal(social.status().facebook, "disconnected");
});

test("disconnect while selecting prevents selected-account resurrection", async (t) => {
  const { social, connect } = fixture(t);
  await connect("facebook");
  let release!: () => void;
  globalThis.fetch = (async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return Response.json({ data: [page] });
  }) as typeof fetch;
  const pending = social.select("facebook", "123");
  social.disconnect("facebook");
  release();
  await assert.rejects(pending, /changed/);
  assert.equal(social.status().facebook, "disconnected");
});

test("selection changes revision and activity is bounded", async (t) => {
  const { social, replies, connect } = fixture(t);
  await connect("facebook");
  replies.push({ data: [page] });
  await social.select("facebook", "123");
  const before = social.revision("facebook");
  replies.push({ data: [page] });
  await social.select("facebook", "123");
  assert.notEqual(social.revision("facebook"), before);
  replies.push({
    data: Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      message: "x".repeat(5000),
      comments: {
        data: Array.from({ length: 12 }, (_, j) => ({
          id: String(j + 1),
          message: "y".repeat(3000),
        })),
      },
    })),
  });
  const activity = await social.activity("facebook");
  assert.equal(activity.posts.length, 10);
  assert.equal(activity.posts[0].text.length, 4000);
  assert.equal(activity.posts[0].comments.length, 10);
  assert.equal(activity.posts[0].comments[0].text.length, 2000);
});

test("Facebook account discovery avoids Instagram-only fields", async (t) => {
  const { social, connect } = fixture(t);
  await connect("facebook");
  globalThis.fetch = (async (url) => {
    const fields = new URL(String(url)).searchParams.get("fields");
    assert.equal(fields, "id,name,access_token");
    return Response.json({ data: [page] });
  }) as typeof fetch;
  assert.deepEqual(await social.accounts("facebook"), [
    { id: "123", name: "Page" },
  ]);
});
