import { PassThrough } from "node:stream";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import {
  AppError,
  timezone,
  validateWav,
  type Planner,
  type Calendar,
} from "./domain.ts";
import { Store } from "./store.ts";
import { MetaPlanner, MockPlanner } from "./meta.ts";
import { GoogleCalendar, MockCalendar } from "./calendar.ts";
import { Service } from "./service.ts";
import { synthesizeSpeech } from "./speech.ts";
const sessionParams = z.object({ id: z.uuid() });
const actionParams = z.object({ id: z.uuid(), actionId: z.uuid() });
export async function buildApp(
  config: Config,
  overrides: { planner?: Planner; calendar?: Calendar; store?: Store } = {},
) {
  const store =
    overrides.store || new Store(config.DATABASE_PATH, config.ENCRYPTION_KEY);
  // A database cannot accidentally mix simulated and real action receipts.
  const mode = store.get<string>("config", "mode");
  if (mode && mode !== config.APP_MODE) {
    store.close();
    throw new Error("Use a separate DATABASE_PATH when changing APP_MODE");
  }
  store.put("config", "mode", config.APP_MODE);
  const google = new GoogleCalendar(config, store),
    calendar =
      overrides.calendar ||
      (config.APP_MODE === "mock" ? new MockCalendar(store) : google);
  const service = new Service(
    store,
    overrides.planner ||
      (config.APP_MODE === "mock"
        ? new MockPlanner()
        : new MetaPlanner(config)),
    calendar,
    config.APP_MODE === "mock",
  );
  const app = Fastify({
    bodyLimit: 6 * 1024 * 1024,
    logger: false,
    requestTimeout: 65000,
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.addContentTypeParser(
    "audio/wav",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    const path = req.url.split("?")[0];
    if (path === "/health" || path === "/oauth/google/callback") return;
    const provided = Buffer.from(
        req.headers.authorization?.replace(/^Bearer /, "") || "",
      ),
      expected = Buffer.from(config.API_TOKEN);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    )
      throw new AppError(401, "unauthorized", "authentication required");
  });
  // Structured metadata only: never log URL queries, tokens, audio, transcripts or Calendar content.
  app.addHook("onResponse", async (req, reply) => {
    if (process.env.NODE_ENV !== "test")
      console.log(
        JSON.stringify({
          requestId: req.id,
          method: req.method,
          route: req.routeOptions.url,
          status: reply.statusCode,
          elapsedMs: Math.round(reply.elapsedTime),
        }),
      );
  });
  app.setErrorHandler((error, req, reply) => {
    const known = error instanceof AppError,
      validation = error instanceof z.ZodError;
    const frameworkStatus = (error as { statusCode?: number }).statusCode;
    const message = known
      ? error.message
      : validation
        ? "check the request fields"
        : "request failed; please try again";
    const status = known
      ? error.status
      : validation
        ? 400
        : frameworkStatus && frameworkStatus >= 400 && frameworkStatus < 500
          ? frameworkStatus
          : 500;
    reply.code(status).send({
      error: {
        code: known
          ? error.code
          : validation
            ? "invalid_request"
            : status === 500
              ? "internal_error"
              : "request_rejected",
        message: known
          ? error.message
          : validation
            ? "check the request fields"
            : status === 500
              ? "something went wrong; please try again"
              : "request rejected",
        requestId: req.id,
      },
      state:
        known && error.code === "calendar_disconnected"
          ? "permission"
          : "error",
      statusText: message,
      speechText: message,
      simulated: config.APP_MODE === "mock",
    });
  });
  app.get("/health", async () => ({ ok: true }));
  app.get("/v1/status", async () => ({
    mode: config.APP_MODE,
    calendar:
      config.APP_MODE === "mock"
        ? "simulated"
        : google.connected()
          ? "connected"
          : "disconnected",
    calendarConfigured: Boolean(
      config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET,
    ),
    calendarRedirectUri: config.GOOGLE_REDIRECT_URI,
    calendarEnabled:
      store.get<boolean>("integration", "calendar-enabled") !== false,
    speechOutput:
      config.APP_MODE === "live" && config.ELEVENLABS_API_KEY
        ? "elevenlabs"
        : "client_tts",
    audio: { format: "mono PCM WAV", bits: 16, maxSeconds: 60 },
    singleUser: true,
  }));
  app.post(
    "/v1/speech",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { text } = z
        .object({ text: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(req.body);
      const controller = new AbortController();
      const close = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.on("close", close);
      try {
        return reply
          .type("audio/mpeg")
          .send(await synthesizeSpeech(config, text, controller.signal));
      } finally {
        reply.raw.off("close", close);
      }
    },
  );
  app.post("/v1/sessions", async (req, reply) => {
    const body = z.object({ timeZone: timezone }).strict().parse(req.body);
    const session = service.createSession(body.timeZone);
    return reply.code(201).send({
      id: session.id,
      timeZone: session.timeZone,
      simulated: service.simulated,
    });
  });
  app.get("/v1/sessions/:id/events", async (req) => ({
    events: service.events(sessionParams.parse(req.params).id),
    simulated: service.simulated,
  }));
  app.post(
    "/v1/sessions/:id/turns",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const { id } = sessionParams.parse(req.params);
      const input = z
        .object({
          requestId: z.uuid(),
          text: z.string().trim().min(1).max(4000),
        })
        .strict()
        .parse(req.body);
      return service.turn(id, input.requestId, { text: input.text });
    },
  );
  app.post("/v1/sessions/:id/turns/:requestId/cancel", async (req) => {
    const { id, requestId } = z
      .object({ id: z.uuid(), requestId: z.uuid() })
      .parse(req.params);
    return service.cancelTurn(id, requestId);
  });
  app.post(
    "/v1/sessions/:id/stream",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { id } = sessionParams.parse(req.params);
      const input = z
        .object({
          requestId: z.uuid(),
          text: z.string().trim().min(1).max(4000),
        })
        .strict()
        .parse(req.body);
      service.session(id);
      const output = new PassThrough(),
        controller = new AbortController();
      const close = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.on("close", close);
      const send = (data: unknown) => {
        if (!output.destroyed && !controller.signal.aborted) {
          if (output.writableLength > 65536) {
            controller.abort();
            output.destroy();
            return;
          }
          output.write(JSON.stringify(data) + "\n");
        }
      };
      void service
        .turn(
          id,
          input.requestId,
          { text: input.text },
          {
            signal: controller.signal,
            onText: (text) => send({ type: "text", text }),
          },
        )
        .then((result) => send({ type: "result", result }))
        .catch((error) =>
          send({
            type: "error",
            message: controller.signal.aborted
              ? "request cancelled"
              : "couldn’t complete the reply; please try again",
            code: error instanceof AppError ? error.code : "stream_failed",
          }),
        )
        .finally(() => {
          reply.raw.off("close", close);
          output.end();
        });
      return reply
        .header("Cache-Control", "no-store")
        .type("application/x-ndjson")
        .send(output);
    },
  );
  app.post(
    "/v1/sessions/:id/audio",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req) => {
      const { id } = sessionParams.parse(req.params);
      const requestId = z.uuid().parse(req.headers["idempotency-key"]);
      if (!Buffer.isBuffer(req.body))
        throw new AppError(415, "invalid_audio", "send audio/wav");
      validateWav(req.body);
      return service.turn(id, requestId, { audio: req.body });
    },
  );
  app.get("/v1/sessions/:id/actions/:actionId", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    return {
      action: service.action(id, actionId),
      simulated: service.simulated,
    };
  });
  app.post("/v1/sessions/:id/actions/:actionId/decision", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    const { decision } = z
      .object({ decision: z.enum(["confirm", "cancel"]) })
      .strict()
      .parse(req.body);
    return service.decide(id, actionId, decision);
  });
  app.delete("/v1/sessions/:id", async (req, reply) => {
    await service.deleteSession(sessionParams.parse(req.params).id);
    return reply.code(204).send();
  });
  app.post("/v1/integrations/google/connect", async () => {
    if (config.APP_MODE === "mock")
      throw new AppError(
        409,
        "mock_mode",
        "use live mode to connect a real account",
      );
    return { url: google.authorizationUrl() };
  });
  app.patch("/v1/integrations/google", async (req) => {
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    if (enabled && config.APP_MODE !== "mock" && !google.connected())
      throw new AppError(
        409,
        "calendar_disconnected",
        "Connect Google Calendar before enabling it.",
      );
    store.put("integration", "calendar-enabled", enabled);
    return { enabled };
  });
  app.delete("/v1/integrations/google", async () => {
    google.disconnect();
    return {
      disconnected: true,
      note: "local credentials removed; revoke access in Google Account settings to revoke the grant",
    };
  });
  app.get("/oauth/google/callback", async (req, reply) => {
    const query = z
      .object({
        state: z.string().min(1).max(100),
        code: z.string().min(1).max(4096).optional(),
        error: z.string().max(200).optional(),
      })
      .parse(req.query);
    if (config.APP_MODE !== "live")
      throw new AppError(409, "mock_mode", "not available in mock mode");
    if (query.error) {
      google.cancelAuthorization(query.state);
      return reply
        .type("text/plain")
        .send(
          "Google Calendar was not connected. No new access was saved. Return to the emulator and tap Connect to try again.",
        );
    }
    if (!query.code)
      throw new AppError(
        400,
        "missing_oauth_code",
        "No sign-in code received. Return to Calendar and try again.",
      );
    await google.callback(query.state, query.code);
    return reply
      .type("text/plain")
      .send("Calendar connected. You may close this tab.");
  });
  app.addHook("onClose", async () => store.close());
  return { app, service, store };
}
