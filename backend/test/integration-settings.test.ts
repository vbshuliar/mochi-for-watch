import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { buildApp } from "../src/app.ts";
import { Connection } from "../src/connections.ts";
import { SocialConnections } from "../src/social.ts";
import { GoogleCalendar } from "../src/calendar.ts";
import { MetaPlanner } from "../src/meta.ts";
import { integrationIDs, integrationKey } from "../src/integration-settings.ts";
const config = readConfig({
  APP_MODE: "live",
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  MODEL_API_KEY: "fake",
  DATABASE_PATH: ":memory:",
});
const headers = { authorization: `Bearer ${config.API_TOKEN}` };

test("integration switches require a connection, persist independently and keep grants", async (t) => {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  const { app } = await buildApp(config, { store });
  t.after(() => app.close());
  for (const id of integrationIDs.filter((id) => id !== "safari")) {
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/integrations/${id}/enabled`,
      headers,
      payload: { enabled: true },
    });
    assert.equal(r.statusCode, 409);
  }
  for (const id of ["google", "gmail", "notion"])
    store.put("secret", id, {
      access: "fake",
      epoch: "epoch",
      expiresAt: Date.now() + 3600000,
    });
  for (const id of ["instagram", "facebook"]) {
    store.put("social-generation", id, "generation");
    store.put("social-grant", id, {
      generation: "generation",
      expiresAt: Date.now() + 3600000,
      selected: { id: "123", name: "Test", token: "fake" },
    });
  }
  for (const id of integrationIDs) {
    for (const enabled of [false, true]) {
      const r = await app.inject({
        method: "PATCH",
        url: `/v1/integrations/${id}/enabled`,
        headers,
        payload: { enabled },
      });
      assert.equal(r.statusCode, 200);
      assert.equal(store.get("integration", integrationKey(id)), enabled);
      const status = (await app.inject({ url: "/v1/status", headers })).json();
      assert.equal(status.integrationEnabled[id], enabled);
      assert.equal(
        status[
          id === "google-calendar"
            ? "calendar"
            : id === "safari"
              ? "webSearch"
              : id
        ],
        id === "safari" ? true : "connected",
      );
    }
  }
  assert(store.get("secret", "gmail"));
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/v1/integrations/gmail/enabled",
        payload: { enabled: false },
      })
    ).statusCode,
    401,
  );
});

test("disabled provider transports reject work without external requests", async (t) => {
  const store = new Store(":memory:", config.ENCRYPTION_KEY);
  t.after(() => store.close());
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw Error("unexpected external request");
  });
  for (const id of integrationIDs)
    store.put("integration", integrationKey(id), false);
  for (const provider of ["gmail", "notion"] as const) {
    store.put("secret", provider, {
      access: "fake",
      epoch: "epoch",
      expiresAt: Date.now() + 3600000,
    });
    await assert.rejects(
      new Connection(provider, config, store).request("profile"),
      { code: "integration_disabled" },
    );
  }
  for (const provider of ["instagram", "facebook"] as const)
    await assert.rejects(
      new SocialConnections(config, store).activity(provider),
      { code: "integration_disabled" },
    );
  store.put("secret", "google", {
    access: "fake",
    epoch: "epoch",
    expiresAt: Date.now() + 3600000,
  });
  await assert.rejects(
    new GoogleCalendar(config, store).list({
      start: "2026-11-04T10:00:00Z",
      end: "2026-11-04T11:00:00Z",
    }),
    { code: "integration_disabled" },
  );
  assert.equal(requests, 0);
});

test("disabled web search rejects a search plan before calling the search provider", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({ kind: "web_search", query: "news" }),
          },
        },
      ],
    });
  });
  await assert.rejects(
    new MetaPlanner(config, () => false).plan(
      [{ role: "user", content: "search for news" }],
      "UTC",
    ),
    { code: "integration_disabled" },
  );
  assert.equal(
    requests,
    1,
    "Only the conversation routing call may run, not web search",
  );
});
