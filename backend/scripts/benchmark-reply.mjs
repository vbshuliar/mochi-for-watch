// Opt-in provider benchmark: no database, service orchestration or action execution.
import { performance } from "node:perf_hooks";
import { readConfig } from "../dist/config.js";
import { MetaPlanner } from "../dist/meta.js";

if (process.argv.slice(2).join(" ") !== "--live") {
  throw new Error("Pass --live to authorize paid synthetic model requests.");
}
const config = readConfig();
if (config.APP_MODE !== "live")
  throw new Error("Use a dedicated live provider configuration.");
const cases = [
  { label: "greeting", text: "Hi Mochi, how are you?", kind: "reply" },
  { label: "explanation", text: "Why is the sky blue?", kind: "reply" },
  { label: "missing-details", text: "Book me a haircut.", kind: "clarify" },
  {
    label: "hypothetical",
    text: "Could you explain how booking a haircut works? Do not book anything.",
    kind: "reply",
  },
];
const rows = [];
for (const [index, fixture] of cases.entries()) {
  // Alternate order to reduce warm-up bias. Only these public synthetic prompts
  // leave the process; never load the owner's history, memories or contacts.
  for (const effort of index % 2 ? ["minimal", "low"] : ["low", "minimal"]) {
    let firstTextMs = null;
    const start = performance.now();
    const plan = await new MetaPlanner(
      {
        ...config,
        META_PLANNER_REASONING_EFFORT: effort,
      },
      () => false,
    ).plan([{ role: "user", content: fixture.text }], "Europe/London", {
      onText: () => {
        firstTextMs ??= Math.round(performance.now() - start);
      },
    });
    const row = {
      label: fixture.label,
      effort,
      firstTextMs,
      totalMs: Math.round(performance.now() - start),
      kind: plan.kind,
      expectedKind: plan.kind === fixture.kind,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
    if (!row.expectedKind) process.exitCode = 1;
  }
}
for (const effort of ["low", "minimal"]) {
  const samples = rows
    .filter((row) => row.effort === effort)
    .map((row) => row.totalMs)
    .sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      effort,
      samples: samples.length,
      medianModelMs: (samples[1] + samples[2]) / 2,
    }),
  );
}
