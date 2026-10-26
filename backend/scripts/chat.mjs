import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomUUID } from "node:crypto";
import { api } from "./client.mjs";
const status = await api("/v1/status");
console.log(
  `Muse for Watch — ${status.mode.toUpperCase()} mode. /yes confirms the displayed event; /no cancels it; /events shows progress; /quit exits.`,
);
const session = await api("/v1/sessions", {
    timeZone: process.env.USER_TIMEZONE || "Europe/London",
  }),
  rl = createInterface({ input: stdin, output: stdout });
let pending;
console.log(`Session: ${session.id}`);
try {
  while (true) {
    const text = (await rl.question("you> ")).trim();
    if (text === "/quit") break;
    if (!text) continue;
    try {
      let response;
      if (text === "/events") {
        console.log(
          JSON.stringify(
            await api(`/v1/sessions/${session.id}/events`),
            null,
            2,
          ),
        );
        continue;
      }
      if (text === "/yes" || text === "/no") {
        if (!pending) {
          console.log("No pending action.");
          continue;
        }
        response = await api(
          `/v1/sessions/${session.id}/actions/${pending}/decision`,
          { decision: text === "/yes" ? "confirm" : "cancel" },
        );
      } else
        response = await api(`/v1/sessions/${session.id}/turns`, {
          requestId: randomUUID(),
          text,
        });
      pending =
        response.action &&
        ["pending", "uncertain"].includes(response.action.status)
          ? response.action.id
          : undefined;
      console.log(`buddy [${response.state}]> ${response.speechText}`);
      if (response.action?.status === "pending")
        console.log(
          "Review before /yes:",
          JSON.stringify(response.action.event, null, 2),
        );
      if (response.data) console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error(error.message);
    }
  }
} finally {
  rl.close();
  console.log(
    `Session retained for recovery. Delete with DELETE /v1/sessions/${session.id} when finished.`,
  );
}
