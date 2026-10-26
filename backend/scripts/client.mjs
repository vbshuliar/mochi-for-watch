export const base =
  process.env.BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
export async function api(
  path,
  body,
  method = body === undefined ? "GET" : "POST",
  headers = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN || ""}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `${response.status}: ${data.error?.message || "request failed"}`,
    );
  return data;
}
