import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";

process.env.NODE_ENV = "test";

test("landing page is public while APIs and non-website files remain protected", async (t) => {
  const { app } = await buildApp(
    readConfig({
      API_TOKEN: "a".repeat(64),
      ENCRYPTION_KEY: "b".repeat(64),
      DATABASE_PATH: ":memory:",
    }),
  );
  t.after(() => app.close());
  const homepage = await app.inject("/");
  assert.equal(homepage.statusCode, 200);
  assert.match(homepage.headers["content-type"]!, /text\/html/);
  assert.match(homepage.body, /Muse for Watch/);
  assert.match(
    homepage.headers["content-security-policy"]!,
    /frame-ancestors 'none'/,
  );
  assert.equal(homepage.headers["x-content-type-options"], "nosniff");
  for (const url of [
    "/index.html",
    "/site.js",
    "/mouse-gaze.js",
    "/style.css?v=1",
    "/assets/tuck.png",
    "/assets/tuck-face.png",
    "/assets/watch-3d.png",
  ]) {
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, url);
  }
  const markdown = await app.inject("/agent.md");
  assert.equal(markdown.statusCode, 200);
  assert.match(markdown.headers["content-type"]!, /text\/plain/);
  assert.match(markdown.body, /^# Muse for Watch/);
  assert.match(markdown.body, /## Instructions for coding agents/);
  assert.equal(
    (await app.inject({ method: "POST", url: "/agent.md" })).statusCode,
    401,
  );
  const head = await app.inject({ method: "HEAD", url: "/" });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");
  for (const url of [
    "/v1/status",
    "/.env",
    "/assets/private.json",
    "/assets/%2e%2e/.env",
    "/style.css/private",
  ]) {
    assert.equal((await app.inject(url)).statusCode, 401, url);
  }
  assert.equal(
    (await app.inject({ method: "POST", url: "/" })).statusCode,
    401,
  );
  const status = await app.inject({
    url: "/v1/status",
    headers: { authorization: `Bearer ${"a".repeat(64)}` },
  });
  assert.equal(status.statusCode, 200);
  assert.equal((await app.inject("/health")).statusCode, 200);
});
