// Run with the owner's backend environment loaded; never put tokens in arguments.
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const url = new URL(process.env.BACKEND_URL || "http://127.0.0.1:8787");
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Use an HTTPS backend origin or local HTTP origin.");
  if (!process.env.API_TOKEN)
    throw new Error("Load the owner's API_TOKEN privately first.");
  const response = await fetch(new URL(path, url), {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`Pairing operation failed (HTTP ${response.status}).`);
  return response.status === 204 ? null : response.json();
}
const [command, ...args] = process.argv.slice(2);
try {
  if (command === "issue") {
    const result = await api("/v1/pairing/codes", {
      name: args.join(" ") || "My iPhone and Watch",
    });
    console.log(
      `One-time pairing code: ${result.code}\nExpires: ${new Date(result.expiresAt).toISOString()}\nEnter this privately in the iPhone connection screen. It can only be used once.`,
    );
  } else if (command === "list")
    console.log(JSON.stringify(await api("/v1/pairing/devices"), null, 2));
  else if (command === "revoke" && /^[a-f0-9-]{36}$/i.test(args[0] || "")) {
    await api(`/v1/pairing/devices/${args[0]}`, undefined, "DELETE");
    console.log("Device access revoked.");
  } else
    throw new Error(
      "Usage: pairing.mjs issue [device name] | list | revoke <device UUID>",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
