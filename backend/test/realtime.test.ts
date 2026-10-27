import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { attachRealtime } from "../src/realtime.ts";
import { readConfig } from "../src/config.ts";

test("realtime authenticates, streams partials, and waits for an explicit end before final", async (t) => {
  const provider = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(provider, "listening");
  const server = createServer();
  const config = readConfig({
    APP_MODE: "live",
    API_TOKEN: "a".repeat(64),
    MODEL_API_KEY: "provider-secret",
    ENCRYPTION_KEY: "b".repeat(64),
  });
  const address = provider.address() as { port: number };
  const stop = attachRealtime(
    server,
    config,
    () => new WebSocket(`ws://127.0.0.1:${address.port}`),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    stop();
    for (const c of provider.clients) c.terminate();
    provider.close();
    server.close();
  });
  let chunks = 0;
  provider.on("connection", (socket) =>
    socket.on("message", (raw, binary) => {
      if (binary) {
        chunks++;
        socket.send(
          JSON.stringify({
            type: "transcript",
            final: false,
            transcript: "hello",
          }),
        );
        return;
      }
      const msg = JSON.parse(raw.toString());
      if (msg.type === "endStream") {
        socket.send(
          JSON.stringify({
            type: "transcript",
            final: true,
            transcript: "Hello Jolly.",
          }),
        );
      } else {
        assert.equal(msg.authorization.accessToken, "Bearer provider-secret");
        assert.equal(msg.audioEncoding, "PCM_24KHZ");
        socket.send(JSON.stringify({ sessionId: "test" }));
      }
    }),
  );
  const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/v1/realtime`;
  const denied = new WebSocket(url);
  await assert.rejects(once(denied, "open"), /403/);
  const client = new WebSocket(url, {
    headers: { Authorization: "Bearer " + config.API_TOKEN },
  });
  t.after(() => client.terminate());
  const ready = JSON.parse(String((await once(client, "message"))[0]));
  assert.deepEqual(ready, { type: "ready" });
  const partial = once(client, "message");
  client.send(Buffer.alloc(4800));
  assert.deepEqual(JSON.parse(String((await partial)[0])), {
    type: "partial",
    text: "hello",
  });
  assert.equal(chunks, 1);
  assert.equal(client.readyState, WebSocket.OPEN);
  const final = once(client, "message");
  client.send(JSON.stringify({ type: "end" }));
  assert.deepEqual(JSON.parse(String((await final)[0])), {
    type: "final",
    text: "Hello Jolly.",
  });
});
