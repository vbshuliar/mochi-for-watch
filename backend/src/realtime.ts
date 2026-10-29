import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { Config } from "./config.ts";

// One short, in-memory transcription stream; it cannot execute agent actions.
export function attachRealtime(
  server: Server,
  config: Config,
  connect = (url: string) => new WebSocket(url, { maxPayload: 65536 }),
  authorize?: (token: string) => boolean,
) {
  const tokens = new WeakMap<WebSocket, string>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  server.on("upgrade", (req, socket, head) => {
    const expected = Buffer.from(config.API_TOKEN);
    const provided = Buffer.from(
      req.headers.authorization?.replace(/^Bearer /, "") || "",
    );
    if (
      req.url !== "/v1/realtime" ||
      !(authorize
        ? authorize(provided.toString())
        : provided.length === expected.length &&
          timingSafeEqual(provided, expected)) ||
      config.APP_MODE !== "live" ||
      wss.clients.size >= 2
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      tokens.set(client, provided.toString());
      wss.emit("connection", client);
    });
  });
  wss.on("connection", (client) => {
    const url = new URL(config.META_BASE_URL + "/asr/realtime");
    url.protocol = "wss:";
    const upstream = connect(url.toString());
    let ready = false,
      ended = false,
      complete = false,
      bytes = 0;
    const send = (value: unknown) => {
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify(value));
    };
    const fail = () => {
      send({ type: "error", message: "live transcription unavailable" });
      client.close(1011);
      upstream.close();
    };
    const deadline = setTimeout(fail, 75000);
    const handshake = setTimeout(fail, 10000);
    let finalDeadline: ReturnType<typeof setTimeout> | undefined;
    upstream.on("open", () =>
      upstream.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${config.MODEL_API_KEY}` },
          model: config.META_TRANSCRIBE_MODEL,
          audioEncoding: "PCM_24KHZ",
          mode: "PUSH_TO_TALK",
          partialMode: "CUMULATIVE",
          emitAudioProgress: false,
        }),
      ),
    );
    upstream.on("message", (raw, binary) => {
      if (binary) return;
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === "error") {
          fail();
          return;
        }
        if (!ready && event.sessionId) {
          ready = true;
          clearTimeout(handshake);
          send({ type: "ready" });
          return;
        }
        if (
          event.type === "transcript" &&
          typeof event.transcript === "string"
        ) {
          if (event.transcript.length > 4000) {
            fail();
            return;
          }
          if (event.final === true) {
            if (!ended || !event.transcript.trim()) {
              fail();
              return;
            }
            complete = true;
            send({ type: "final", text: event.transcript.trim() });
            client.close(1000);
            upstream.close();
          } else send({ type: "partial", text: event.transcript });
        }
      } catch {
        fail();
      }
    });
    client.on("message", (raw, binary) => {
      if (authorize && !authorize(tokens.get(client) ?? "")) {
        fail();
        return;
      }
      if (!ready || ended) {
        fail();
        return;
      }
      if (binary) {
        const chunk = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw);
        bytes += chunk.byteLength;
        if (
          bytes > 24000 * 2 * 60 ||
          chunk.byteLength % 2 ||
          upstream.bufferedAmount > 256000
        ) {
          fail();
          return;
        }
        upstream.send(chunk, { binary: true });
      } else {
        try {
          if (JSON.parse(raw.toString()).type !== "end") {
            fail();
            return;
          }
        } catch {
          fail();
          return;
        }
        ended = true;
        upstream.send(JSON.stringify({ type: "endStream" }));
        finalDeadline = setTimeout(fail, 10000);
      }
    });
    upstream.on("error", fail);
    client.on("error", () => upstream.close());
    upstream.on("close", () => {
      if (!complete && client.readyState === WebSocket.OPEN) fail();
    });
    client.on("close", () => {
      clearTimeout(deadline);
      clearTimeout(handshake);
      clearTimeout(finalDeadline);
      upstream.close();
    });
  });
  return () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
}
