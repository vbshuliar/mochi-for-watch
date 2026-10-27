import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";

test("speech requires auth, validates text, hides credentials and returns MP3", async (t) => {
  const config = readConfig({
    APP_MODE: "live",
    API_TOKEN: "a".repeat(64),
    ENCRYPTION_KEY: "b".repeat(64),
    MODEL_API_KEY: "test-meta",
    ELEVENLABS_API_KEY: "test-eleven-secret",
    DATABASE_PATH: ":memory:",
  });
  const { app } = await buildApp(config);
  t.after(() => app.close());
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  let calls = 0,
    fail = false;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.match(
      String(url),
      /elevenlabs.io\/v1\/text-to-speech\/cgSgspJ2msm6clMCkdW9/,
    );
    assert.equal(
      (init!.headers as Record<string, string>)["xi-api-key"],
      "test-eleven-secret",
    );
    assert.equal(JSON.parse(String(init!.body)).model_id, "eleven_flash_v2_5");
    return fail
      ? new Response("private provider error", { status: 401 })
      : new Response(Buffer.from("ID3test"), {
          headers: { "content-type": "audio/mpeg" },
        });
  };
  const headers = { authorization: "Bearer " + config.API_TOKEN };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/speech",
        payload: { text: "hi" },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/speech",
        headers,
        payload: { text: "x".repeat(2001) },
      })
    ).statusCode,
    400,
  );
  assert.equal(calls, 0);
  const status = (await app.inject({ url: "/v1/status", headers })).json();
  assert.equal(status.speechOutput, "elevenlabs");
  assert(!JSON.stringify(status).includes("test-eleven-secret"));
  const speech = await app.inject({
    method: "POST",
    url: "/v1/speech",
    headers,
    payload: { text: "hey, good to see you." },
  });
  assert.equal(speech.statusCode, 200);
  assert.equal(speech.headers["content-type"], "audio/mpeg");
  assert.equal(speech.body, "ID3test");
  fail = true;
  const failure = await app.inject({
    method: "POST",
    url: "/v1/speech",
    headers,
    payload: { text: "hi" },
  });
  assert.equal(failure.statusCode, 502);
  assert(!failure.body.includes("private provider error"));
});
test("mock mode never spends ElevenLabs credits", async (t) => {
  const { app } = await buildApp(
    readConfig({
      API_TOKEN: "a".repeat(64),
      ENCRYPTION_KEY: "b".repeat(64),
      ELEVENLABS_API_KEY: "unused",
      DATABASE_PATH: ":memory:",
    }),
  );
  t.after(() => app.close());
  const response = await app.inject({
    method: "POST",
    url: "/v1/speech",
    headers: { authorization: "Bearer " + "a".repeat(64) },
    payload: { text: "hi" },
  });
  assert.equal(response.statusCode, 409);
});
