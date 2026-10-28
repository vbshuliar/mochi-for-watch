import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import type { Store } from "./store.ts";
import { AppError } from "./domain.ts";
import { externalFetch } from "./http.ts";

export type SocialProvider = "instagram" | "facebook";
export type SocialAccount = { id: string; name: string };
type Choice = SocialAccount & { token: string };
type Grant = {
  token: string;
  expiresAt: number;
  generation: string;
  selected?: Choice;
};
type Pending = { state: string; generation: string; expiresAt: number };
const scopes = {
  instagram: [
    "pages_show_list",
    "pages_read_engagement",
    "instagram_basic",
    "instagram_manage_comments",
  ],
  facebook: [
    "pages_show_list",
    "pages_read_engagement",
    "pages_read_user_content",
  ],
};
const idSchema = z
  .string()
  .regex(/^\d+(?:_\d+)?$/)
  .max(100);
const tokenSchema = z.object({
  access_token: z.string().min(1).max(8192),
  expires_in: z
    .number()
    .positive()
    .max(366 * 86400),
});
const pagesSchema = z.object({
  data: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().min(1).max(500),
        access_token: z.string().min(1).max(8192),
        instagram_business_account: z
          .object({
            id: idSchema,
            username: z.string().max(500).optional(),
            name: z.string().max(500).optional(),
          })
          .optional(),
      }),
    )
    .max(100),
});
const permissionsSchema = z.object({
  data: z
    .array(
      z.object({ permission: z.string().max(100), status: z.string().max(30) }),
    )
    .max(100),
});
const textField = z.string().max(50000).optional();
const activitySchema = z.object({
  data: z
    .array(
      z.object({
        id: idSchema,
        message: textField,
        caption: textField,
        created_time: z.string().max(100).optional(),
        timestamp: z.string().max(100).optional(),
        comments: z
          .object({
            data: z
              .array(
                z.object({
                  id: idSchema,
                  text: textField,
                  message: textField,
                  username: z.string().max(500).optional(),
                  from: z.object({ name: z.string().max(500) }).optional(),
                  timestamp: z.string().max(100).optional(),
                  created_time: z.string().max(100).optional(),
                }),
              )
              .max(100),
          })
          .optional(),
      }),
    )
    .max(100),
});
const problem = (message: string, status = 400) =>
  new AppError(status, "social_connection", message);
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw problem("The social service returned an invalid response", 502);
  return result.data;
}

export class SocialConnections {
  constructor(
    private config: Config,
    private store: Store,
  ) {}
  private check(provider: SocialProvider) {
    if (provider !== "instagram" && provider !== "facebook")
      throw problem("Unknown social connection");
  }
  private generation(provider: SocialProvider) {
    return this.store.get<string>("social-generation", provider);
  }
  private assertCurrent(provider: SocialProvider, generation: string) {
    if (this.generation(provider) !== generation)
      throw problem("Connection changed; please reconnect", 409);
  }
  private grant(provider: SocialProvider) {
    this.check(provider);
    const grant = this.store.get<Grant>("social-grant", provider);
    if (!grant || grant.expiresAt <= Date.now()) {
      if (grant) this.disconnect(provider);
      throw problem("Please reconnect this social account", 409);
    }
    this.assertCurrent(provider, grant.generation);
    return grant;
  }
  revision(provider: SocialProvider): string | undefined {
    try {
      const grant = this.grant(provider);
      return grant.selected ? grant.generation : undefined;
    } catch {
      return undefined;
    }
  }
  status() {
    const result: {
      instagram: "connected" | "disconnected";
      facebook: "connected" | "disconnected";
      socialAccounts: Partial<Record<SocialProvider, SocialAccount>>;
    } = {
      instagram: "disconnected",
      facebook: "disconnected",
      socialAccounts: {},
    };
    for (const provider of ["instagram", "facebook"] as const) {
      try {
        const selected = this.grant(provider).selected;
        if (selected) {
          result[provider] = "connected";
          result.socialAccounts[provider] = {
            id: selected.id,
            name: selected.name,
          };
        }
      } catch {
        /* Missing or expired grants are disconnected. */
      }
    }
    return result;
  }
  disconnect(provider: SocialProvider) {
    this.check(provider);
    this.store.transaction(() => {
      this.store.put("social-generation", provider, randomUUID());
      this.store.delete("social-grant", provider);
      this.store.delete("social-oauth", provider);
    });
  }
  private redirect(provider: SocialProvider) {
    return `${this.config.META_SOCIAL_REDIRECT_BASE.replace(/\/$/, "")}/oauth/${provider}/callback`;
  }
  authorize(provider: SocialProvider) {
    this.check(provider);
    if (!this.config.META_SOCIAL_APP_ID || !this.config.META_SOCIAL_APP_SECRET)
      throw problem(
        "This connection is not available yet; please try again later",
        503,
      );
    this.disconnect(provider);
    const pending: Pending = {
      state: randomBytes(32).toString("hex"),
      generation: this.generation(provider)!,
      expiresAt: Date.now() + 600000,
    };
    this.store.put("social-oauth", provider, pending);
    return `https://www.facebook.com/${this.config.GRAPH_API_VERSION}/dialog/oauth?${new URLSearchParams({ client_id: this.config.META_SOCIAL_APP_ID, redirect_uri: this.redirect(provider), state: pending.state, response_type: "code", scope: scopes[provider].join(","), auth_type: "rerequest" })}`;
  }
  private async request(
    path: string,
    token?: string,
    signal?: AbortSignal,
    body?: URLSearchParams,
  ) {
    const response = await externalFetch(
      `https://graph.facebook.com/${this.config.GRAPH_API_VERSION}/${path}`,
      {
        method: body ? "POST" : "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body,
        signal,
      },
    );
    // Bound the response before parsing; provider paging URLs are never followed.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            throw problem("Social response is too large", 502);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw problem("The social service returned an invalid response", 502);
    }
    const error = z
      .object({ error: z.object({ code: z.number().optional() }) })
      .safeParse(value);
    if (!response.ok || error.success) {
      if (error.success && [10, 190, 200].includes(error.data.error.code ?? 0))
        throw new AppError(
          409,
          "social_reconnect",
          "Social permission expired or was removed; reconnect this account",
        );
      throw problem("The social service could not complete this request", 502);
    }
    if (signal?.aborted) throw problem("Social request was cancelled", 409);
    return value;
  }
  async callback(provider: SocialProvider, state: string, code?: string) {
    this.check(provider);
    const pending = this.store.get<Pending>("social-oauth", provider);
    if (!pending || !state || pending.state !== state)
      throw problem("Invalid social authorization state");
    this.store.delete("social-oauth", provider); // Consume before any async work, including failed/denied callbacks.
    if (pending.expiresAt <= Date.now())
      throw problem("Social authorization expired");
    this.assertCurrent(provider, pending.generation);
    if (!code) return;
    if (code.length > 8192) throw problem("Invalid social authorization code");
    const token = parse(
      tokenSchema,
      await this.request(
        "oauth/access_token",
        undefined,
        undefined,
        new URLSearchParams({
          client_id: this.config.META_SOCIAL_APP_ID,
          client_secret: this.config.META_SOCIAL_APP_SECRET,
          redirect_uri: this.redirect(provider),
          code,
        }),
      ),
    );
    this.assertCurrent(provider, pending.generation);
    const permissions = parse(
      permissionsSchema,
      await this.request("me/permissions", token.access_token),
    );
    const granted = new Set(
      permissions.data
        .filter((p) => p.status === "granted")
        .map((p) => p.permission),
    );
    if (!scopes[provider].every((scope) => granted.has(scope)))
      throw problem(
        "Required social permissions were not granted; reconnect and approve them",
        409,
      );
    this.assertCurrent(provider, pending.generation);
    this.store.put("social-grant", provider, {
      token: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      generation: pending.generation,
    } satisfies Grant);
  }
  private async withGrant<T>(
    provider: SocialProvider,
    operation: (grant: Grant) => Promise<T>,
  ): Promise<T> {
    const grant = this.grant(provider);
    try {
      const result = await operation(grant);
      this.assertCurrent(provider, grant.generation);
      this.grant(provider);
      return result;
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "social_reconnect" &&
        this.generation(provider) === grant.generation
      )
        this.disconnect(provider);
      throw error;
    }
  }
  private async choices(
    provider: SocialProvider,
    grant: Grant,
    signal?: AbortSignal,
  ): Promise<Choice[]> {
    const fields =
      provider === "instagram"
        ? "id,name,access_token,instagram_business_account{id,username,name}"
        : "id,name,access_token";
    const result = parse(
      pagesSchema,
      await this.request(
        `me/accounts?${new URLSearchParams({ fields, limit: "100" })}`,
        grant.token,
        signal,
      ),
    );
    return result.data.flatMap((page) => {
      if (provider === "facebook")
        return [{ id: page.id, name: page.name, token: page.access_token }];
      const ig = page.instagram_business_account;
      return ig
        ? [
            {
              id: ig.id,
              name: ig.username || ig.name || page.name,
              token: page.access_token,
            },
          ]
        : [];
    });
  }
  async accounts(
    provider: SocialProvider,
    signal?: AbortSignal,
  ): Promise<SocialAccount[]> {
    return this.withGrant(provider, async (grant) =>
      (await this.choices(provider, grant, signal)).map(({ id, name }) => ({
        id,
        name,
      })),
    );
  }
  async select(provider: SocialProvider, id: string) {
    if (!idSchema.safeParse(id).success)
      throw problem("Invalid social account");
    await this.withGrant(provider, async (grant) => {
      const selected = (await this.choices(provider, grant)).find(
        (choice) => choice.id === id,
      );
      if (!selected) throw problem("This account was not authorized", 403);
      this.assertCurrent(provider, grant.generation);
      this.grant(provider);
      // Re-select invalidates in-flight activity results for the previous account.
      const generation = randomUUID();
      this.store.put("social-generation", provider, generation);
      this.store.put("social-grant", provider, {
        ...grant,
        generation,
        selected,
      });
      grant.generation = generation;
    });
  }
  async activity(provider: SocialProvider, signal?: AbortSignal) {
    return this.withGrant(provider, async (grant) => {
      const account = grant.selected;
      if (!account) throw problem("Choose a social account first", 409);
      const fields =
        provider === "instagram"
          ? "id,caption,timestamp,comments.limit(10){id,text,username,timestamp}"
          : "id,message,created_time,comments.limit(10){id,message,from,created_time}";
      const data = parse(
        activitySchema,
        await this.request(
          `${account.id}/${provider === "instagram" ? "media" : "posts"}?${new URLSearchParams({ fields, limit: "10" })}`,
          account.token,
          signal,
        ),
      );
      return {
        provider,
        account: { id: account.id, name: account.name },
        posts: data.data.slice(0, 10).map((post) => ({
          id: post.id,
          text: (post.caption ?? post.message ?? "").slice(0, 4000),
          createdAt: post.timestamp ?? post.created_time,
          comments: (post.comments?.data ?? []).slice(0, 10).map((comment) => ({
            id: comment.id,
            text: (comment.text ?? comment.message ?? "").slice(0, 2000),
            author: comment.username ?? comment.from?.name,
            createdAt: comment.timestamp ?? comment.created_time,
          })),
        })),
      };
    });
  }
}
