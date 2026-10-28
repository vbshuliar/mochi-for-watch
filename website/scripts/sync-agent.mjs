import { readFile, writeFile } from "node:fs/promises";

const page = new URL("../dist/index.html", import.meta.url);
const markdown = await readFile(
  new URL("../dist/agent.md", import.meta.url),
  "utf8",
);
const html = await readFile(page, "utf8");
const start = "<!-- AGENT_MARKDOWN_START -->";
const end = "<!-- AGENT_MARKDOWN_END -->";
if (!html.includes(start) || !html.includes(end)) {
  throw new Error("Agent Markdown markers are missing from index.html");
}
const escaped = markdown
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
await writeFile(
  page,
  html.slice(0, html.indexOf(start) + start.length) +
    escaped +
    html.slice(html.indexOf(end)),
);
