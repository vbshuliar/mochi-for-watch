import { cp, mkdir, stat } from "node:fs/promises";

const source = new URL("../../website/dist/", import.meta.url);
const destination = new URL("../public/", import.meta.url);
await stat(new URL("index.html", source));
await mkdir(destination, { recursive: true });
// Copy only the files exposed by the website routes.
for (const file of [
  "index.html",
  "agent.md",
  "style.css",
  "assets/jolly.png",
  "assets/jolly-face.png",
  "assets/watch-3d.png",
]) {
  await cp(new URL(file, source), new URL(file, destination));
}
console.log("Staged website assets in backend/public.");
