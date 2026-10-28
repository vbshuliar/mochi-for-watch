import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import { Store } from "./store.ts";
import {
  AppError,
  type Calendar,
  type EventInput,
  type Window,
  type Receipt,
} from "./domain.ts";
import { externalFetch, externalJson } from "./http.ts";
const scopes = [
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
];
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});
type Tokens = {
  access: string;
  refresh?: string;
  expiresAt: number;
  epoch?: string;
};
const googleEvent = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().optional(),
  htmlLink: z.url().optional(),
  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
  }),
  end: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
  }),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
});
function receipt(data: z.infer<typeof googleEvent>): Receipt {
  return {
    id: data.id,
    title: data.summary || "(untitled)",
    start: data.start.dateTime || data.start.date || "",
    end: data.end.dateTime || data.end.date || "",
    url: data.htmlLink,
    simulated: false,
  };
}
export class GoogleCalendar implements Calendar {
  private refreshes = new Map<string, Promise<string>>();
  constructor(
    private config: Config,
    private store: Store,
  ) {}
  private configured() {
    if (!this.config.GOOGLE_CLIENT_ID || !this.config.GOOGLE_CLIENT_SECRET)
      throw new AppError(
        503,
        "google_not_configured",
        "configure Google OAuth on the server first",
      );
  }
  authorizationUrl() {
    this.configured();
    const state = randomBytes(32).toString("hex"),
      verifier = randomBytes(32).toString("base64url");
    // Only one pending account connection is needed in this single-user prototype.
    this.store.put("oauth", "pending", {
      state,
      verifier,
      expiresAt: Date.now() + 600000,
    });
    const params = new URLSearchParams({
      client_id: this.config.GOOGLE_CLIENT_ID,
      redirect_uri: this.config.GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
  private consumeAuthorization(state: string) {
    const pending = this.store.get<{
      state: string;
      verifier: string;
      expiresAt: number;
      consumed?: boolean;
    }>("oauth", "pending");
    if (
      !pending ||
      pending.consumed ||
      pending.state !== state ||
      pending.expiresAt < Date.now()
    )
      throw new AppError(
        400,
        "invalid_oauth_state",
        "connection expired; start again",
      );
    this.store.put("oauth", "pending", { ...pending, consumed: true });
    return pending;
  }
  cancelAuthorization(state: string) {
    this.consumeAuthorization(state);
    this.store.delete("oauth", "pending");
  }
  async callback(state: string, code: string) {
    const pending = this.consumeAuthorization(state);
    try {
      const data = tokenSchema.parse(
        await externalJson(
          await externalFetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            body: new URLSearchParams({
              code,
              client_id: this.config.GOOGLE_CLIENT_ID,
              client_secret: this.config.GOOGLE_CLIENT_SECRET,
              redirect_uri: this.config.GOOGLE_REDIRECT_URI,
              grant_type: "authorization_code",
              code_verifier: pending.verifier,
            }),
          }),
        ),
      );
      if (
        !scopes.every((scope) => data.scope?.split(" ").includes(scope)) ||
        !data.refresh_token
      )
        throw new AppError(
          400,
          "missing_calendar_permission",
          "grant Calendar access and offline access, then reconnect",
        );
      if (
        this.store.get<{ state: string }>("oauth", "pending")?.state !== state
      )
        throw new AppError(
          409,
          "connection_changed",
          "Calendar connection changed; start again",
        );
      this.store.put("secret", "google", {
        epoch: randomUUID(),
        access: data.access_token,
        refresh: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      });
    } finally {
      if (
        this.store.get<{ state: string }>("oauth", "pending")?.state === state
      )
        this.store.delete("oauth", "pending");
    }
  }
  connected() {
    return !!this.store.get("secret", "google");
  }
  disconnect() {
    this.store.delete("secret", "google");
    this.store.delete("oauth", "pending");
  }
  private epoch(): string {
    const tokens = this.store.get<Tokens>("secret", "google");
    if (!tokens)
      throw new AppError(
        409,
        "calendar_disconnected",
        "connect Calendar on your phone or computer",
      );
    // Upgrade credentials saved before connection epochs were introduced.
    if (!tokens.epoch) {
      tokens.epoch = randomUUID();
      this.store.put("secret", "google", tokens);
    }
    return tokens.epoch;
  }
  private assertEpoch(epoch: string) {
    if (this.store.get<Tokens>("secret", "google")?.epoch !== epoch)
      throw new AppError(
        409,
        "connection_changed",
        "Calendar connection changed; try again",
      );
  }
  private async token(epoch: string): Promise<string> {
    this.assertEpoch(epoch);
    const tokens = this.store.get<Tokens>("secret", "google")!;
    if (tokens.expiresAt > Date.now() + 60000) return tokens.access;
    if (!tokens.refresh)
      throw new AppError(409, "calendar_disconnected", "reconnect Calendar");
    let refresh = this.refreshes.get(epoch);
    if (!refresh) {
      refresh = (async () => {
        const response = await externalFetch(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            body: new URLSearchParams({
              client_id: this.config.GOOGLE_CLIENT_ID,
              client_secret: this.config.GOOGLE_CLIENT_SECRET,
              refresh_token: tokens.refresh!,
              grant_type: "refresh_token",
            }),
          },
        );
        this.assertEpoch(epoch);
        if (response.status === 400) {
          // Invalidate only these credentials, preserving any pending reconnect.
          this.store.delete("secret", "google");
          throw new AppError(
            409,
            "calendar_disconnected",
            "reconnect Calendar",
          );
        }
        const data = tokenSchema.parse(await externalJson(response));
        this.assertEpoch(epoch);
        this.store.put("secret", "google", {
          epoch,
          access: data.access_token,
          refresh: data.refresh_token || tokens.refresh,
          expiresAt: Date.now() + data.expires_in * 1000,
        });
        return data.access_token;
      })().finally(() => {
        this.refreshes.delete(epoch);
      });
      this.refreshes.set(epoch, refresh);
    }
    return refresh;
  }
  private async request(
    path: string,
    init: RequestInit = {},
    epoch = this.epoch(),
  ) {
    const token = await this.token(epoch);
    this.assertEpoch(epoch);
    const response = await externalFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
    );
    this.assertEpoch(epoch);
    return response;
  }
  async list(window: Window, signal?: AbortSignal) {
    const epoch = this.epoch();
    const items: Receipt[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        timeMin: window.start,
        timeMax: window.end,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const data = z
        .object({
          items: z.array(googleEvent).default([]),
          nextPageToken: z.string().optional(),
        })
        .parse(
          await externalJson(
            await this.request(`events?${params}`, { signal }, epoch),
          ),
        );
      this.assertEpoch(epoch);
      items.push(
        ...data.items.filter((e) => e.status !== "cancelled").map(receipt),
      );
      pageToken = data.nextPageToken;
      if (!pageToken) return items;
    }
    throw new AppError(422, "too_many_events", "choose a shorter date range");
  }
  async busy(window: Window, signal?: AbortSignal) {
    const epoch = this.epoch();
    const token = await this.token(epoch);
    this.assertEpoch(epoch);
    // Use Google's freeBusy endpoint so all-day and transparent events are handled by Google.
    const response = await externalFetch(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        signal,
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timeMin: window.start,
          timeMax: window.end,
          items: [{ id: "primary" }],
        }),
      },
    );
    const data = z
      .object({
        calendars: z.record(
          z.string(),
          z.object({
            busy: z
              .array(z.object({ start: z.string(), end: z.string() }))
              .optional(),
            errors: z.array(z.unknown()).optional(),
          }),
        ),
      })
      .parse(await externalJson(response));
    this.assertEpoch(epoch);
    const calendar = data.calendars.primary;
    if (!calendar || calendar.errors?.length || !calendar.busy)
      throw new AppError(
        502,
        "availability_failed",
        "couldn’t check availability",
      );
    return calendar.busy;
  }
  async create(id: string, event: EventInput) {
    const epoch = this.epoch();
    // Recovery must stay on the original connection: event IDs are account-local.
    this.store.transaction(() => {
      const binding = this.store.get<{ epoch: string }>("calendar_action", id);
      if (binding && binding.epoch !== epoch)
        throw new AppError(
          409,
          "connection_changed",
          "Calendar connection changed; check the original Calendar before creating a new request",
        );
      if (!binding) this.store.put("calendar_action", id, { epoch });
    });
    const eventId = id.replaceAll("-", "");
    const verify = (data: unknown) => {
      this.assertEpoch(epoch);
      const parsed = googleEvent.parse(data);
      if (
        parsed.status === "cancelled" ||
        parsed.id !== eventId ||
        parsed.extendedProperties?.private?.museActionId !== id ||
        parsed.summary !== event.title ||
        Date.parse(parsed.start.dateTime || "") !== Date.parse(event.start) ||
        Date.parse(parsed.end.dateTime || "") !== Date.parse(event.end)
      )
        throw new AppError(
          409,
          "receipt_mismatch",
          "the saved event differs; check Calendar before trying again",
        );
      return receipt(parsed);
    };
    const existing = await this.request(`events/${eventId}`, {}, epoch);
    if (existing.ok) return verify(await existing.json());
    if (existing.status !== 404) await externalJson(existing);
    const result = await this.request(
      "events",
      {
        method: "POST",
        body: JSON.stringify({
          id: eventId,
          summary: event.title,
          start: { dateTime: event.start, timeZone: event.timeZone },
          end: { dateTime: event.end, timeZone: event.timeZone },
          extendedProperties: { private: { museActionId: id } },
        }),
      },
      epoch,
    );
    if (!result.ok && result.status !== 409) await externalJson(result);
    // Read-after-write verifies the persisted event, including recovery after an uncertain POST.
    return verify(
      await externalJson(await this.request(`events/${eventId}`, {}, epoch)),
    );
  }
}
export class MockCalendar implements Calendar {
  constructor(private store: Store) {}
  async list(window: Window) {
    return this.store
      .list<Receipt>("mock_event")
      .map((r) => r.value)
      .filter(
        (e) =>
          Date.parse(e.start) < Date.parse(window.end) &&
          Date.parse(e.end) > Date.parse(window.start),
      );
  }
  async busy(window: Window) {
    return (await this.list(window)).map(({ start, end }) => ({ start, end }));
  }
  async create(id: string, event: EventInput) {
    const saved = this.store.get<Receipt>("mock_event", id);
    if (saved) return saved;
    const result = {
      id,
      title: event.title,
      start: event.start,
      end: event.end,
      simulated: true,
    };
    this.store.put("mock_event", id, result);
    return result;
  }
}
