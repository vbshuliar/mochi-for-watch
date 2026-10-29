import { isWebsiteRequest, registerWebsite } from "./website.ts";
import { PassThrough } from "node:stream";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import {
  AppError,
  bookingChangeSchema,
  timezone,
  validateWav,
  type Planner,
  type Calendar,
} from "./domain.ts";
import { Store } from "./store.ts";
import { MetaPlanner, MockPlanner } from "./meta.ts";
import { GoogleCalendar, MockCalendar } from "./calendar.ts";
import { Workflows } from "./workflows.ts";
import { SocialConnections } from "./social.ts";
import { SocialWorkflow } from "./social-workflow.ts";
import { Calls } from "./calls.ts";
import { Notifications } from "./notifications.ts";
import { Briefing } from "./briefing.ts";
import {
  Reminders,
  reminderInputSchema,
  reminderUpdateSchema,
} from "./reminders.ts";
import { GmailDrafts, gmailDraftInputSchema } from "./gmail-drafts.ts";
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
  const workflows = new Workflows(config, store);
  const social = new SocialConnections(config, store);
  const notifications = new Notifications(config, store);
  const calls = new Calls(
    config,
    store,
    calendar,
    () =>
      google.connected() &&
      store.get<boolean>("integration", "calendar-enabled") !== false,
    (call) => notifications.enqueue(call),
  );
  const reminders = new Reminders(store, (occurrence) =>
    notifications.enqueueReminder(occurrence),
  );
  const drafts = new GmailDrafts(config, store, workflows.gmail);
  const briefing = new Briefing({
    calendar,
    calls,
    reminders,
    mail: (query, signal) => workflows.mail(query, signal),
    calendarStatus: () =>
      store.get<boolean>("integration", "calendar-enabled") === false
        ? "disabled"
        : config.APP_MODE === "mock"
          ? "simulated"
          : google.connected()
            ? "connected"
            : "disconnected",
    gmailStatus: () =>
      config.APP_MODE === "mock"
        ? "simulated"
        : workflows.gmail.connected()
          ? "connected"
          : "disconnected",
    simulated: config.APP_MODE === "mock",
  });
  const service = new Service(
    store,
    overrides.planner ||
      (config.APP_MODE === "mock"
        ? new MockPlanner()
        : new MetaPlanner(config)),
    calendar,
    config.APP_MODE === "mock",
    workflows,
    calls,
    new SocialWorkflow(config, social),
    { reminders, briefing, drafts },
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
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 16384 },
    (_req, body, done) => {
      const params = new URLSearchParams(body as string),
        result: Record<string, string> = Object.create(null);
      for (const [key, value] of params) {
        if (Object.hasOwn(result, key)) {
          done(
            new AppError(400, "duplicate_field", "Duplicate callback field."),
          );
          return;
        }
        result[key] = value;
      }
      done(null, result);
    },
  );
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    const path = req.url.split("?")[0];
    if (isWebsiteRequest(req.method, path)) return;
    if (path.startsWith("/webhooks/calls/") || path.startsWith("/call-audio/"))
      return;
    if (
      [
        "/health",
        "/oauth/google/callback",
        "/oauth/gmail/callback",
        "/oauth/notion/callback",
        "/oauth/instagram/callback",
        "/oauth/facebook/callback",
      ].includes(path)
    )
      return;
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
  registerWebsite(app);
  app.get("/health", async () => ({ ok: true }));
  app.get("/v1/briefing", async (req) => {
    const query = z.object({ timeZone: timezone }).strict().parse(req.query);
    return briefing.get(query.timeZone);
  });
  app.get("/v1/reminders", async () => ({ reminders: reminders.list() }));
  app.post("/v1/reminders", async (req) => {
    const input = reminderInputSchema.parse(req.body);
    if (
      input.sourceCallId &&
      !calls.listAll().some((call) => call.id === input.sourceCallId)
    )
      throw new AppError(404, "not_found", "Booking not found.");
    return { reminder: reminders.create(input) };
  });
  app.patch("/v1/reminders/:id", async (req) => ({
    reminder: reminders.update(
      sessionParams.parse(req.params).id,
      reminderUpdateSchema.parse(req.body),
    ),
  }));
  app.delete("/v1/reminders/:id", async (req, reply) => {
    reminders.remove(sessionParams.parse(req.params).id);
    return reply.code(204).send();
  });
  app.get("/v1/drafts", async () => ({ drafts: drafts.list() }));
  app.post("/v1/sessions/:id/drafts", async (req) => {
    const { id } = sessionParams.parse(req.params);
    service.session(id);
    return service.draftResult(
      id,
      drafts.prepare(id, gmailDraftInputSchema.parse(req.body)),
    );
  });
  app.get("/v1/sessions/:id/drafts/:actionId", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    service.session(id);
    return { action: drafts.get(id, actionId) };
  });
  app.post("/v1/sessions/:id/drafts/:actionId/decision", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    const { decision } = z
      .object({ decision: z.enum(["confirm", "cancel"]) })
      .strict()
      .parse(req.body);
    return service.decideDraft(id, actionId, decision);
  });
  app.get("/v1/status", async () => ({
    mode: config.APP_MODE,
    callsConfigured: calls.configured(),
    ...workflows.status(),
    gmailDraftsEnabled: workflows.gmail.canDraft(),
    ...social.status(),
    webSearch: config.APP_MODE === "live",
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
  app.get("/v1/memories", async () => ({ memories: service.memories() }));
  app.post("/v1/memories", async (req, reply) =>
    reply.code(201).send(service.saveMemory(req.body)),
  );
  app.patch("/v1/memories/:id", async (req) =>
    service.saveMemory(req.body, sessionParams.parse(req.params).id),
  );
  app.delete("/v1/memories/:id", async (req, reply) => {
    service.deleteMemory(sessionParams.parse(req.params).id);
    return reply.code(204).send();
  });
  app.delete("/v1/memories", async (_req, reply) => {
    service.deleteMemory();
    return reply.code(204).send();
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
              : error instanceof AppError && error.code === "search_unavailable"
                ? "couldn’t verify that online; please try again"
                : error instanceof AppError &&
                    [
                      "connection_required",
                      "notion_destination_required",
                      "connection_changed",
                      "workflow_unavailable",
                      "mock_mode",
                      "connection_unavailable",
                      "social_account_required",
                      "social_permission_required",
                      "social_reconnect_required",
                      "social_connection",
                      "social_reconnect",
                    ].includes(error.code)
                  ? error.message
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
  for (const provider of ["instagram", "facebook"] as const) {
    const requireSocialLive = () => {
      if (config.APP_MODE !== "live")
        throw new AppError(
          409,
          "mock_mode",
          "use live mode to connect a real account",
        );
    };
    app.post(`/v1/integrations/${provider}/connect`, async () => {
      requireSocialLive();
      return { url: social.authorize(provider) };
    });
    app.delete(`/v1/integrations/${provider}`, async () => {
      social.disconnect(provider);
      return {
        disconnected: true,
        note: "Local access removed. You can also revoke access in Facebook settings.",
      };
    });
    app.get(`/v1/integrations/${provider}/accounts`, async () => {
      requireSocialLive();
      return { accounts: await social.accounts(provider) };
    });
    app.put(`/v1/integrations/${provider}/account`, async (req) => {
      requireSocialLive();
      const { id } = z
        .object({ id: z.string().regex(/^\d{1,40}$/) })
        .strict()
        .parse(req.body);
      await social.select(provider, id);
      return social.status();
    });
    app.get(`/oauth/${provider}/callback`, async (req, reply) => {
      requireSocialLive();
      const query = z
        .object({
          state: z.string().min(1).max(100),
          code: z.string().min(1).max(4096).optional(),
          error: z.string().max(200).optional(),
        })
        .parse(req.query);
      if (!query.code && !query.error)
        throw new AppError(
          400,
          "missing_oauth_code",
          "No sign-in code received. Please connect again.",
        );
      await social.callback(
        provider,
        query.state,
        query.error ? undefined : query.code,
      );
      return reply
        .type("text/plain")
        .send(
          query.error
            ? "Connection cancelled. Return to Muse to try again."
            : "Sign-in complete. Return to Muse and choose the account Jolly should use.",
        );
    });
  }
  for (const provider of ["gmail", "notion"] as const) {
    const connection = workflows[provider];
    app.post(`/v1/integrations/${provider}/connect`, async (req) => {
      if (config.APP_MODE !== "live")
        throw new AppError(
          409,
          "mock_mode",
          "use live mode to connect a real account",
        );
      const options = z
        .object({ drafts: z.boolean().optional() })
        .strict()
        .parse(req.body ?? {});
      return { url: connection.authorize(options) };
    });
    app.delete(`/v1/integrations/${provider}`, async () => {
      connection.disconnect();
      return {
        disconnected: true,
        note: "Local credentials removed. You can also revoke the grant in the provider’s settings.",
      };
    });
    app.get(`/oauth/${provider}/callback`, async (req, reply) => {
      if (config.APP_MODE !== "live")
        throw new AppError(409, "mock_mode", "not available in mock mode");
      const q = z
        .object({
          state: z.string().min(1).max(100),
          code: z.string().min(1).max(4096).optional(),
          error: z.string().max(200).optional(),
        })
        .parse(req.query);
      if (!q.code && !q.error)
        throw new AppError(
          400,
          "missing_oauth_code",
          "No sign-in code received. Please connect again.",
        );
      await connection.callback(q.state, q.error ? undefined : q.code);
      return reply
        .type("text/plain")
        .send(
          q.error
            ? "Connection cancelled. You may return to Muse."
            : "Connected. Return to Muse to finish setup.",
        );
    });
  }
  app.get("/v1/integrations/notion/pages", async (req) => {
    const { query } = z
      .object({ query: z.string().max(100).default("") })
      .parse(req.query);
    return workflows.pages(query);
  });
  app.post("/v1/integrations/notion/pages/search", async (req) => {
    const { query } = z
      .object({ query: z.string().max(100).default("") })
      .strict()
      .parse(req.body);
    return workflows.pages(query);
  });
  app.put("/v1/integrations/notion/destination", async (req) => {
    const { id } = z.object({ id: z.uuid() }).strict().parse(req.body);
    return workflows.setParent(id);
  });
  app.get("/v1/sessions/:id/documents/:actionId", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    service.session(id);
    return { action: workflows.action(id, actionId) };
  });
  app.post("/v1/sessions/:id/documents/:actionId/decision", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    const { decision } = z
      .object({ decision: z.enum(["confirm", "cancel"]) })
      .strict()
      .parse(req.body);
    return service.decideDocument(id, actionId, decision);
  });
  app.get("/v1/sessions/:id/calls", async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    service.session(id);
    return { calls: calls.list(id) };
  });
  // This deployment has one private account/token. Session IDs remain part of
  // mutation URLs so an approval always targets its original persisted action.
  app.get("/v1/tasks", async () => ({
    calls: calls.listAll(),
    simulated: service.simulated,
  }));
  app.get("/v1/notifications/status", async () => notifications.status());
  app.post("/v1/notifications/devices", async (req) =>
    notifications.register(req.body),
  );
  app.delete("/v1/notifications/devices/:id", async (req, reply) => {
    notifications.remove(sessionParams.parse(req.params).id);
    return reply.code(204).send();
  });
  app.get("/v1/sessions/:id/calls/:actionId", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    service.session(id);
    return { callAction: calls.publicAction(calls.get(id, actionId)) };
  });
  app.post("/v1/sessions/:id/calls/:actionId/decision", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    service.session(id);
    const { decision } = z
      .object({ decision: z.enum(["confirm", "cancel"]) })
      .strict()
      .parse(req.body);
    return calls.decide(id, actionId, decision);
  });
  app.post("/v1/sessions/:id/calls/:actionId/stop", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    service.session(id);
    return calls.stop(id, actionId);
  });
  app.post("/v1/sessions/:id/calls/:actionId/calendar", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    service.session(id);
    return calls.proposeCalendar(id, actionId);
  });
  app.post("/v1/sessions/:id/calls/:actionId/change", async (req) => {
    const { id, actionId } = actionParams.parse(req.params);
    service.session(id);
    return calls.prepareChange(
      id,
      actionId,
      bookingChangeSchema.parse(req.body),
    );
  });
  for (const route of ["voice/:turn", "gather/:turn", "status"]) {
    app.post(
      `/webhooks/calls/:actionId/${route}`,
      { bodyLimit: 16384 },
      async (req, reply) => {
        const { actionId, turn } = z
          .object({
            actionId: z.uuid(),
            turn: z.coerce.number().int().min(0).max(12).optional(),
          })
          .parse(req.params);
        const body = z.record(z.string(), z.string()).parse(req.body);
        calls.verify(
          req.url,
          body,
          String(req.headers["x-twilio-signature"] || ""),
        );
        if (route === "status") {
          calls.status(actionId, body);
          return reply.code(204).send();
        }
        return reply
          .type("text/xml")
          .send(
            route.startsWith("voice")
              ? calls.voice(actionId, turn!, body)
              : calls.gather(actionId, turn!, body),
          );
      },
    );
  }
  app.get("/call-audio/:token", async (req, reply) => {
    const { token } = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.params);
    return reply.type("audio/mpeg").send(calls.audio(token));
  });
  app.addHook("onClose", async () => {
    reminders.close();
    await calls.close();
    await notifications.close();
    store.close();
  });
  app.addHook("onReady", async () => {
    // Recover an alert if the process stopped after persisting a call outcome.
    for (const call of calls.listAll()) notifications.enqueue(call);
    reminders.start();
    notifications.start();
  });
  return {
    app,
    service,
    store,
    calls,
    notifications,
    reminders,
    briefing,
    drafts,
  };
}
