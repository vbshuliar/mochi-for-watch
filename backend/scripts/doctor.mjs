import { existsSync } from "node:fs";
const checks = {
  node24: Number(process.versions.node.split(".")[0]) >= 24,
  envFile: existsSync(".env"),
  apiToken: (process.env.API_TOKEN || "").length >= 32,
  encryptionKey: /^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_KEY || ""),
  mode: ["mock", "live"].includes(process.env.APP_MODE || "mock"),
};
if (process.env.APP_MODE === "live") {
  checks.metaKey = !!process.env.MODEL_API_KEY;
  checks.googleClient = !!process.env.GOOGLE_CLIENT_ID;
  checks.googleSecret = !!process.env.GOOGLE_CLIENT_SECRET;
}
for (const [name, ok] of Object.entries(checks))
  console.log(`${ok ? "OK" : "MISSING"} ${name}`);
console.log(
  "Checks configuration presence only; no paid API calls or account changes.",
);
if (Object.values(checks).some((ok) => !ok)) process.exitCode = 1;
