import { randomUUID } from "node:crypto";
import { api } from "./client.mjs";
const status = await api("/v1/status");
if (status.mode !== "mock")
  throw new Error(
    "Demo script only runs in mock mode; it never creates a real event.",
  );
const session = await api("/v1/sessions", { timeZone: "Europe/London" });
try {
  const turn = await api(`/v1/sessions/${session.id}/turns`, {
    requestId: randomUUID(),
    text: "schedule demo lunch",
  });
  console.log("PROPOSAL", JSON.stringify(turn, null, 2));
  const path = `/v1/sessions/${session.id}/actions/${turn.action.id}/decision`;
  const done = await api(path, { decision: "confirm" });
  console.log("CONFIRMED", JSON.stringify(done, null, 2));
  const retry = await api(path, { decision: "confirm" });
  if (retry.data.id !== done.data.id)
    throw new Error("Duplicate confirmation created another event");
  console.log("Duplicate confirmation returned the same receipt.");
  console.log(
    "TIMELINE",
    JSON.stringify(await api(`/v1/sessions/${session.id}/events`), null, 2),
  );
} finally {
  await api(`/v1/sessions/${session.id}`, undefined, "DELETE");
}
