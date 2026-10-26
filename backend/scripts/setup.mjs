import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
if (existsSync(".env")) {
  console.log(".env already exists; nothing changed.");
  process.exit(0);
}
const template = readFileSync(".env.example", "utf8")
  .replace("API_TOKEN=\n", `API_TOKEN=${randomBytes(32).toString("hex")}\n`)
  .replace(
    "ENCRYPTION_KEY=\n",
    `ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`,
  );
writeFileSync(".env", template, { mode: 0o600, flag: "wx" });
console.log("Created private .env with local credentials. Run npm run dev.");
