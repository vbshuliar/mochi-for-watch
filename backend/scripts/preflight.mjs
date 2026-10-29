const origin = process.env.BACKEND_URL;
const token = process.env.API_TOKEN;
try {
  if (!origin || !token)
    throw new Error("Set BACKEND_URL and API_TOKEN in the environment.");
  const url = new URL(origin);
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "BACKEND_URL must be an HTTPS origin or local HTTP origin without credentials or paths.",
    );
  const response = await fetch(new URL("/v1/readiness", url), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      `Readiness unavailable (HTTP ${response.status}). No provider actions were performed.`,
    );
  const result = await response.json();
  if (!Array.isArray(result.checks))
    throw new Error("Invalid readiness response.");
  console.log(`Revision: ${result.revision}; mode: ${result.mode}`);
  for (const check of result.checks)
    console.log(`${check.status}: ${check.title} — ${check.detail}`);
  console.log(
    `Today: ${result.usage?.callAttempts ?? "unknown"} / ${result.usage?.callLimit ?? "unknown"} call attempts (UTC). Actual provider charges are not measured.`,
  );
  console.log(
    "Read-only configuration preflight. Live booking and device acceptance still require a separate approved run.",
  );
  if (!result.configurationReady) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Preflight failed.");
  process.exitCode = 1;
}
