import { z } from "zod";
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = z
    .object({
      HOST: z.enum(["127.0.0.1", "0.0.0.0"]).default("127.0.0.1"),
      PORT: z.coerce.number().int().min(1).max(65535).default(8787),
      APP_MODE: z.enum(["mock", "live"]).default("mock"),
      API_TOKEN: z.string().min(32),
      ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
      DATABASE_PATH: z.string().default("./data/muse.sqlite"),
      MODEL_API_KEY: z.string().default(""),
      META_BASE_URL: z.url().default("https://api.meta.ai/v1"),
      META_MODEL: z.string().default("muse-spark-1.3"),
      META_TRANSCRIBE_MODEL: z.string().default("muse-voice-transcribe-1.0"),
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
  const redirect = new URL(c.GOOGLE_REDIRECT_URI);
  if (
    redirect.protocol !== "https:" &&
    !(redirect.protocol === "http:" && redirect.hostname === "127.0.0.1")
  )
    throw new Error("OAuth redirect must use HTTPS or loopback HTTP");
  return c;
}
export type Config = ReturnType<typeof readConfig>;
