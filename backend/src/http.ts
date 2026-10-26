import { AppError } from "./domain.ts";
export async function externalFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    throw new AppError(
      502,
      "provider_unavailable",
      "service unavailable; please try again",
    );
  }
}
export async function externalJson(response: Response): Promise<unknown> {
  if (!response.ok)
    throw new AppError(
      response.status === 429 ? 503 : 502,
      "provider_error",
      "the service could not complete this request",
    );
  try {
    return await response.json();
  } catch {
    throw new AppError(
      502,
      "invalid_provider_response",
      "the service returned an unreadable response",
    );
  }
}
