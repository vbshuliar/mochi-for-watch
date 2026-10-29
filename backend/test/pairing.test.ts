import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { Pairing } from "../src/pairing.ts";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
process.env.NODE_ENV = "test";
const config = readConfig({
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  DATABASE_PATH: ":memory:",
});
test("pairing codes are expiring single use and tokens are hashed, revocable and restart durable", (t) => {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  t.after(() => store.close());
  let now = 10000;
  const pairing = new Pairing(store, config.API_TOKEN, () => now);
  const issued = pairing.issue({ name: "Phone and Watch" });
  const result = pairing.redeem({ code: issued.code.toLowerCase() });
  assert.equal(pairing.authorized(result.token), true);
  assert.equal(pairing.isOwner(result.token), false);
  assert.throws(() => pairing.redeem({ code: issued.code }));
  assert.equal(
    JSON.stringify(store.list("paired-device")).includes(result.token),
    false,
  );
  assert.equal(JSON.stringify(pairing.list()).includes("tokenHash"), false);
  assert.equal(
    new Pairing(store, config.API_TOKEN, () => now).authorized(result.token),
    true,
  );
  pairing.revoke(result.deviceId);
  assert.equal(pairing.authorized(result.token), false);
  const expired = pairing.issue({ name: "Expired" });
  now += 300001;
  assert.throws(() => pairing.redeem({ code: expired.code }));
  const fresh = pairing.redeem({ code: pairing.issue({ name: "New" }).code });
  now = fresh.expiresAt;
  assert.equal(pairing.authorized(fresh.token), false);
});
test("only owner can administer pairing; paired devices can access their private assistant", async (t) => {
  const f = await buildApp(config);
  t.after(() => f.app.close());
  const owner = { authorization: `Bearer ${config.API_TOKEN}` };
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        payload: { name: "Phone" },
      })
    ).statusCode,
    401,
  );
  const code = (
    await f.app.inject({
      method: "POST",
      url: "/v1/pairing/codes",
      headers: owner,
      payload: { name: "Phone" },
    })
  ).json().code;
  const pair = await f.app.inject({
    method: "POST",
    url: "/v1/pairing/redeem",
    payload: { code },
  });
  assert.equal(pair.statusCode, 200, pair.body);
  const device = pair.json(),
    headers = { authorization: `Bearer ${device.token}` };
  assert.equal(
    (await f.app.inject({ url: "/v1/status", headers })).statusCode,
    200,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/v1/pairing/codes",
        headers,
        payload: { name: "Another" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await f.app.inject({ url: "/v1/pairing/devices", headers })).statusCode,
    403,
  );
  for (const route of ["/v1/%70airing", "/v1/pair%69ng", "/v1/pairing"]) {
    assert.equal(
      (await f.app.inject({ url: `${route}/devices`, headers })).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `${route}/codes`,
          headers,
          payload: { name: "Unauthorized" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "DELETE",
          url: `${route}/devices/${device.deviceId}`,
          headers,
        })
      ).statusCode,
      403,
    );
  }
  const pushId = "995ee646-f5a2-4530-99cf-fbf400cbf345";
  const registered = await f.app.inject({
    method: "POST",
    url: "/v1/notifications/devices",
    headers,
    payload: {
      id: pushId,
      token: "aa".repeat(32),
      platform: "ios",
      environment: "sandbox",
    },
  });
  assert.equal(registered.statusCode, 200);
  assert.ok(f.store.get("push-device", pushId));
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/v1/pairing/devices/${device.deviceId}`,
        headers: owner,
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await f.app.inject({ url: "/v1/status", headers })).statusCode,
    401,
  );
  assert.equal(f.store.get("push-device", pushId), undefined);
  for (let i = 0; i < 5; i++)
    await f.app.inject({
      method: "POST",
      url: "/v1/pairing/redeem",
      payload: { code: "wrong" },
    });
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/v1/pairing/redeem",
        payload: { code: "wrong" },
      })
    ).statusCode,
    429,
  );
});

test("re-pairing transfers alert ownership and expiry returns current registrations for removal", (t) => {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  t.after(() => store.close());
  let now = 1000;
  const p = new Pairing(store, config.API_TOKEN, () => now);
  const a = p.redeem({ code: p.issue({ name: "Old" }).code });
  p.bindPush(a.token, "phone-push");
  const b = p.redeem({ code: p.issue({ name: "New" }).code });
  p.bindPush(b.token, "phone-push");
  assert.deepEqual(p.revoke(a.deviceId), []);
  assert.equal(p.authorized(b.token), true);
  now = b.expiresAt;
  assert.deepEqual(p.expiredPushes(), ["phone-push"]);
  assert.equal(p.authorized(b.token), false);
  assert.equal(store.list("paired-device").length, 0);
});
