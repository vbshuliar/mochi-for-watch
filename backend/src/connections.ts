import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { Store } from "./store.ts";
import { externalFetch, externalJson } from "./http.ts";
export type Provider = "gmail" | "notion";
const gmailScope = "https://www.googleapis.com/auth/gmail.readonly";
type Tokens = {
  access: string;
  refresh?: string;
  expiresAt: number;
  epoch: string;
};
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
});
export class Connection {
  private refreshing?: Promise<string>;
  constructor(
    readonly provider: Provider,
    private config: Config,
    private store: Store,
  ) {}
  private settings() {
    return this.provider === "gmail"
      ? {
          id: this.config.GOOGLE_CLIENT_ID,
          secret: this.config.GOOGLE_CLIENT_SECRET,
          redirect: this.config.GMAIL_REDIRECT_URI,
          authorize: "https://accounts.google.com/o/oauth2/v2/auth",
          token: "https://oauth2.googleapis.com/token",
        }
      : {
          id: this.config.NOTION_CLIENT_ID,
          secret: this.config.NOTION_CLIENT_SECRET,
          redirect: this.config.NOTION_REDIRECT_URI,
          authorize: "https://api.notion.com/v1/oauth/authorize",
          token: "https://api.notion.com/v1/oauth/token",
        };
  }
  configured() {
    const s = this.settings();
    return !!(s.id && s.secret);
  }
  epoch() {
    return this.store.get<Tokens>("secret", this.provider)?.epoch;
  }
  connected() {
    return !!this.epoch();
  }
  disconnect() {
    this.store.delete("secret", this.provider);
    this.store.delete("oauth", this.provider);
    if (this.provider === "notion")
      this.store.delete("integration", "notion-parent");
  }
  authorize() {
    if (!this.configured())
      throw new AppError(
        503,
        "connection_unavailable",
        "connection isn’t available yet; please try again later",
      );
    const s = this.settings(),
      state = randomBytes(32).toString("hex"),
      verifier = randomBytes(32).toString("base64url"),
      generation = randomUUID();
    this.store.put("oauth", this.provider, {
      state,
      verifier,
      generation,
      expiresAt: Date.now() + 600000,
    });
    const params = new URLSearchParams({
      client_id: s.id,
      redirect_uri: s.redirect,
      response_type: "code",
      state,
    });
    if (this.provider === "gmail") {
      params.set("scope", gmailScope);
      params.set("access_type", "offline");
      params.set("prompt", "consent");
      params.set(
        "code_challenge",
        createHash("sha256").update(verifier).digest("base64url"),
      );
      params.set("code_challenge_method", "S256");
    } else params.set("owner", "user");
    return s.authorize + "?" + params;
  }
  async callback(state: string, code?: string) {
    const pending = this.store.get<{
      state: string;
      verifier: string;
      generation: string;
      expiresAt: number;
      consumed?: boolean;
    }>("oauth", this.provider);
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
    // Consume state before any network request. The generation remains as a cancellation guard.
    this.store.put("oauth", this.provider, { ...pending, consumed: true });
    if (!code) {
      this.store.delete("oauth", this.provider);
      return;
    }
    try {
      const data = await this.exchange({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.settings().redirect,
        ...(this.provider === "gmail"
          ? { code_verifier: pending.verifier }
          : {}),
      });
      if (
        this.provider === "gmail" &&
        (!data.scope?.split(" ").includes(gmailScope) || !data.refresh_token)
      )
        throw new AppError(
          400,
          "missing_gmail_permission",
          "allow read-only Gmail access, then reconnect",
        );
      const current = this.store.get<{ generation: string }>(
        "oauth",
        this.provider,
      );
      if (current?.generation !== pending.generation)
        throw new AppError(
          409,
          "connection_changed",
          "connection changed; start again",
        );
      this.store.put("secret", this.provider, {
        access: data.access_token,
        refresh: data.refresh_token,
        expiresAt: data.expires_in
          ? Date.now() + data.expires_in * 1000
          : Number.MAX_SAFE_INTEGER,
        epoch: randomUUID(),
      });
      if (this.provider === "notion")
        this.store.delete("integration", "notion-parent");
    } finally {
      if (
        this.store.get<{ generation: string }>("oauth", this.provider)
          ?.generation === pending.generation
      )
        this.store.delete("oauth", this.provider);
    }
  }
  private async exchange(values: Record<string, string>) {
    const s = this.settings();
    const google = this.provider === "gmail";
    return tokenSchema.parse(
      await externalJson(
        await externalFetch(s.token, {
          method: "POST",
          headers: google
            ? {}
            : {
                Authorization:
                  "Basic " +
                  Buffer.from(s.id + ":" + s.secret).toString("base64"),
                "Content-Type": "application/json",
              },
          body: google
            ? new URLSearchParams({
                ...values,
                client_id: s.id,
                client_secret: s.secret,
              })
            : JSON.stringify(values),
        }),
      ),
    );
  }
  private async token(force = false): Promise<string> {
    const old = this.store.get<Tokens>("secret", this.provider);
    if (!old)
      throw new AppError(
        409,
        "connection_required",
        `connect ${this.provider === "gmail" ? "Gmail" : "Notion"} on your iPhone first`,
      );
    if (!force && old.expiresAt > Date.now() + 60000) return old.access;
    if (!old.refresh)
      throw new AppError(
        409,
        "connection_required",
        "please reconnect this service",
      );
    if (!this.refreshing)
      this.refreshing = (async () => {
        const data = await this.exchange({
          grant_type: "refresh_token",
          refresh_token: old.refresh!,
        });
        if (this.epoch() !== old.epoch)
          throw new AppError(
            409,
            "connection_changed",
            "connection changed; try again",
          );
        this.store.put("secret", this.provider, {
          access: data.access_token,
          refresh: data.refresh_token || old.refresh,
          expiresAt: data.expires_in
            ? Date.now() + data.expires_in * 1000
            : Number.MAX_SAFE_INTEGER,
          epoch: old.epoch,
        });
        return data.access_token;
      })().finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  async request(path: string, init: RequestInit = {}) {
    const epoch = this.epoch();
    const root =
      this.provider === "gmail"
        ? "https://gmail.googleapis.com/gmail/v1/users/me/"
        : "https://api.notion.com/v1/";
    const send = async (force = false) => {
      const token = await this.token(force);
      if (this.epoch() !== epoch)
        throw new AppError(
          409,
          "connection_changed",
          "connection changed; try again",
        );
      return externalFetch(root + path, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(this.provider === "notion"
            ? { "Notion-Version": "2025-09-03" }
            : {}),
        },
      });
    };
    const response = await send();
    return response.status === 401 ? send(true) : response;
  }
}
