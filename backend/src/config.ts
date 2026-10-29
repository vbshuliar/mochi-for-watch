import { z } from "zod";
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = z
    .object({
      HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
      PORT: z.coerce.number().int().min(1).max(65535).default(8787),
      BUILD_REVISION: z.string().max(120).default("unknown"),
      DAILY_CALL_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
      APP_MODE: z.enum(["mock", "live"]).default("mock"),
      API_TOKEN: z.string().min(32),
      ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
      DATABASE_PATH: z.string().default("./data/muse.sqlite"),
      MODEL_API_KEY: z.string().default(""),
      META_BASE_URL: z.url().default("https://api.meta.ai/v1"),
      META_SOCIAL_APP_ID: z.string().default(""),
      META_SOCIAL_APP_SECRET: z.string().default(""),
      META_SOCIAL_REDIRECT_BASE: z.url().default("http://127.0.0.1:8787"),
      GRAPH_API_VERSION: z
        .string()
        .regex(/^v[0-9]{2}\.0$/)
        .default("v24.0"),
      META_MODEL: z.string().default("muse-spark-1.3"),
      META_REASONING_EFFORT: z
        .enum(["minimal", "low", "medium", "high"])
        .default("low"),
      META_TRANSCRIBE_MODEL: z.string().default("muse-voice-transcribe-1.0"),
      TWILIO_ACCOUNT_SID: z.string().default(""),
      TWILIO_AUTH_TOKEN: z.string().default(""),
      TWILIO_ALLOWED_NUMBERS: z.string().default(""),
      TWILIO_FROM_NUMBER: z.string().default(""),
      CALLS_PUBLIC_URL: z.string().default(""),
      APNS_TEAM_ID: z.string().default(""),
      APNS_KEY_ID: z.string().default(""),
      APNS_PRIVATE_KEY: z.string().default(""),
      APNS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
      APNS_TOPIC_IOS: z.string().default("com.museforwatch.app"),
      APNS_TOPIC_WATCHOS: z
        .string()
        .default("com.museforwatch.app.watchkitapp"),
      ELEVENLABS_API_KEY: z.string().default(""),
      ELEVENLABS_VOICE_ID: z
        .string()
        .regex(/^[a-zA-Z0-9]{20}$/)
        .default("cgSgspJ2msm6clMCkdW9"),
      ELEVENLABS_MODEL: z
        .enum(["eleven_flash_v2_5", "eleven_multilingual_v2"])
        .default("eleven_flash_v2_5"),
      GMAIL_REDIRECT_URI: z
        .url()
        .default("http://127.0.0.1:8787/oauth/gmail/callback"),
      NOTION_CLIENT_ID: z.string().default(""),
      NOTION_CLIENT_SECRET: z.string().default(""),
      NOTION_REDIRECT_URI: z
        .url()
        .default("http://127.0.0.1:8787/oauth/notion/callback"),
      GOOGLE_CLIENT_ID: z.string().default(""),
      GOOGLE_CLIENT_SECRET: z.string().default(""),
      GOOGLE_REDIRECT_URI: z
        .url()
        .default("http://127.0.0.1:8787/oauth/google/callback"),
    })
    .parse(env);
  if (c.APP_MODE === "live" && !c.MODEL_API_KEY)
    throw new Error("MODEL_API_KEY is required in live mode");
  if (new URL(c.META_BASE_URL).protocol !== "https:")
    throw new Error("Meta URL must use HTTPS");
  for (const value of [
    c.META_SOCIAL_REDIRECT_BASE,
    c.GOOGLE_REDIRECT_URI,
    c.GMAIL_REDIRECT_URI,
    c.NOTION_REDIRECT_URI,
  ]) {
    const redirect = new URL(value);
    if (
      redirect.protocol !== "https:" &&
      !(redirect.protocol === "http:" && redirect.hostname === "127.0.0.1")
    )
      throw new Error("OAuth redirect must use HTTPS or loopback HTTP");
  }
  return c;
}
export type Config = ReturnType<typeof readConfig>;
