import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const port = Number(process.env.EMULATOR_PORT || 4174),
  origin = `http://127.0.0.1:${port}`;
const backend = `http://127.0.0.1:${Number(process.env.PORT || 8787)}`;
if (!process.env.API_TOKEN)
  throw new Error(
    "Run npm run setup and load .env before starting the emulator",
  );
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ${origin.replace("http:", "ws:")}; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'`,
  );
  if (req.headers.host !== `127.0.0.1:${port}`) {
    send(403, { error: { message: "invalid host" } });
    return;
  }
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith("/api/")) {
      if (
        req.headers["x-muse-emulator"] !== "1" ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        send(403, {
          error: { message: "same-origin emulator access required" },
        });
        return;
      }
      const route = url.pathname.slice(4);
      if (!route.startsWith("/v1/")) {
        send(404, { error: { message: "unknown route" } });
        return;
      }
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 6 * 1024 * 1024) {
          send(413, { error: { message: "recording too large" } });
          return;
        }
        chunks.push(chunk);
      }
      const headers = { Authorization: `Bearer ${process.env.API_TOKEN}` };
      for (const name of ["content-type", "idempotency-key"])
        if (typeof req.headers[name] === "string")
          headers[name] = req.headers[name];
      const controller = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      const upstream = await fetch(backend + route + url.search, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method)
          ? undefined
          : Buffer.concat(chunks),
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(90000),
        ]),
      });
      res.writeHead(upstream.status, {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
      });
      if (upstream.body) {
        for await (const chunk of upstream.body) {
          if (!res.write(chunk))
            await new Promise((resolve, reject) => {
              const drain = () => {
                  cleanup();
                  resolve();
                },
                close = () => {
                  cleanup();
                  reject(new Error("client disconnected"));
                };
              const cleanup = () => {
                res.off("drain", drain);
                res.off("close", close);
              };
              res.once("drain", drain);
              res.once("close", close);
            });
        }
      }
      res.end();
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      send(405, { error: { message: "method not allowed" } });
      return;
    }
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/preview/emulator/";
    if (path.endsWith("/")) path += "index.html";
    const absolute = resolve(root, "." + path);
    const allowed =
      (absolute.startsWith(resolve(root, "preview") + "/") &&
        [".html", ".css", ".js", ".mjs"].includes(extname(absolute))) ||
      (absolute.startsWith(resolve(root, "docs/design") + "/") &&
        [".png", ".svg"].includes(extname(absolute)));
    if (!allowed) {
      send(404, { error: { message: "not found" } });
      return;
    }
    const data = await readFile(absolute);
    res.writeHead(200, { "Content-Type": mime[extname(absolute)] });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    send(error.code === "ENOENT" ? 404 : 502, {
      error: {
        message:
          error.code === "ENOENT"
            ? "not found"
            : "backend unavailable; check that npm start is running",
      },
    });
  }
});
const streams = new WebSocketServer({ noServer: true, maxPayload: 65536 });
server.on("upgrade", (req, socket, head) => {
  if (
    req.url !== "/api/v1/realtime" ||
    req.headers.host !== `127.0.0.1:${port}` ||
    req.headers.origin !== origin ||
    streams.clients.size >= 2
  ) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }
  streams.handleUpgrade(req, socket, head, (client) => {
    const upstream = new WebSocket(
      backend.replace("http:", "ws:") + "/v1/realtime",
      {
        headers: { Authorization: `Bearer ${process.env.API_TOKEN}` },
        maxPayload: 65536,
      },
    );
    const timer = setTimeout(() => {
      client.terminate();
      upstream.terminate();
    }, 80000);
    client.on("message", (data, binary) => {
      if (
        upstream.readyState !== WebSocket.OPEN ||
        upstream.bufferedAmount > 256000
      ) {
        client.close(1011);
        return;
      }
      upstream.send(data, { binary });
    });
    upstream.on("message", (data, binary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });
    upstream.on("error", () => client.close(1011));
    client.on("error", () => upstream.close());
    upstream.on("close", () => client.close());
    client.on("close", () => {
      clearTimeout(timer);
      upstream.close();
    });
  });
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Muse for Watch emulator: ${origin}/preview/emulator/`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    for (const client of streams.clients) client.terminate();
    streams.close();
    server.close(() => process.exit(0));
  });
