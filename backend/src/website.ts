import { createReadStream, existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";

// An explicit allowlist keeps app routes and filesystem contents private.
const files = new Map([
  [
    "/mouse-gaze.js",
    { file: "mouse-gaze.js", type: "text/javascript; charset=utf-8" },
  ],
  ["/site.js", { file: "site.js", type: "text/javascript; charset=utf-8" }],
  ["/agent.md", { file: "agent.md", type: "text/plain; charset=utf-8" }],
  ["/assets/watch-3d.png", { file: "assets/watch-3d.png", type: "image/png" }],
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/style.css", { file: "style.css", type: "text/css; charset=utf-8" }],
  ["/assets/mochi.png", { file: "assets/mochi.png", type: "image/png" }],
  [
    "/assets/mochi-face.png",
    { file: "assets/mochi-face.png", type: "image/png" },
  ],
]);

export function isWebsiteRequest(method: string, path: string): boolean {
  return (method === "GET" || method === "HEAD") && files.has(path);
}

export function registerWebsite(app: FastifyInstance): void {
  const packaged = new URL("../public/", import.meta.url);
  const directory = existsSync(new URL("index.html", packaged))
    ? packaged
    : new URL("../../website/dist/", import.meta.url);
  for (const [path, asset] of files) {
    app.get(path, async (_request, reply) => {
      reply
        .type(asset.type)
        .header("Cache-Control", "public, max-age=0, must-revalidate")
        .header(
          "Content-Security-Policy",
          "default-src 'none'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        );
      return reply.send(createReadStream(new URL(asset.file, directory)));
    });
  }
}
