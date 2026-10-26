import { randomUUID, createHash } from "node:crypto";
import {
  AppError,
  eventSchema,
  planSchema,
  type Action,
  type Calendar,
  type Planner,
  type Session,
  type Timeline,
  type TurnResult,
} from "./domain.ts";
import { Store } from "./store.ts";
type CachedTurn = {
  hash: string;
  status: "processing" | "done" | "failed";
  result?: TurnResult;
};
export class Service {
  private locks = new Set<string>();
  constructor(
    readonly store: Store,
    private planner: Planner,
    private calendar: Calendar,
    readonly simulated: boolean,
  ) {
    for (const { id, value } of store.list<Action>("action"))
      if (value.status === "executing")
        store.put("action", id, { ...value, status: "uncertain" });
    for (const { id, value } of store.list<CachedTurn>("turn"))
      if (value.status === "processing")
        store.put("turn", id, { ...value, status: "failed" });
  }
  session(id: string) {
    const s = this.store.get<Session>("session", id);
    if (!s) throw new AppError(404, "not_found", "session not found");
    return s;
  }
  createSession(timeZone: string) {
    const session: Session = {
      id: randomUUID(),
      timeZone,
      messages: [],
      createdAt: Date.now(),
    };
    this.store.put("session", session.id, session);
    return session;
  }
  events(id: string) {
    this.session(id);
    return this.store.get<Timeline[]>("timeline", id) || [];
  }
  private emit(id: string, state: string, statusText: string) {
    const events = this.events(id);
    events.push({ at: new Date().toISOString(), state, statusText });
    this.store.put("timeline", id, events.slice(-100));
  }
  private result(
    id: string,
    state: string,
    text: string,
    extra: Partial<TurnResult> = {},
  ): TurnResult {
    this.emit(id, state, text);
    return {
      sessionId: id,
      state,
      statusText: text,
      speechText: text,
      simulated: this.simulated,
      ...extra,
    };
  }
  private async locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.locks.has(id))
      throw new AppError(
        409,
        "busy",
        "one moment; a request is already running",
      );
    this.locks.add(id);
    try {
      return await work();
    } finally {
      this.locks.delete(id);
    }
  }
  async turn(
    id: string,
    requestId: string,
    input: { text: string } | { audio: Buffer },
  ) {
    return this.locked(id, async () => {
      const session = this.session(id),
        key = `${id}:${requestId}`,
        hash = createHash("sha256")
          .update("text" in input ? "text:" + input.text : input.audio)
          .digest("hex");
      const cached = this.store.get<CachedTurn>("turn", key);
      if (cached && cached.hash !== hash)
        throw new AppError(
          409,
          "idempotency_conflict",
          "use a new request ID for different input",
        );
      if (cached?.status === "done") return cached.result!;
      this.store.put("turn", key, { hash, status: "processing" });
      try {
        let text: string;
        if ("text" in input) text = input.text;
        else {
          this.emit(id, "transcribe", "making sense of your words…");
          text = await this.planner.transcribe(input.audio);
        }
        this.emit(id, "think", "thinking…");
        const messages = [
          ...session.messages,
          { role: "user" as const, content: text },
        ].slice(-16);
        const plan = planSchema.parse(
          await this.planner.plan(messages, session.timeZone),
        );
        let result: TurnResult;
        // A new request supersedes earlier unapproved proposals in this session.
        const supersede = () => {
          for (const { id: actionId, value } of this.store.list<Action>(
            "action",
          ))
            if (value.sessionId === id && value.status === "pending")
              this.store.put("action", actionId, {
                ...value,
                status: "cancelled",
              });
        };
        if (plan.kind === "create_event") {
          const event = eventSchema.parse(plan.event);
          if (Date.parse(event.start) < Date.now() - 60000)
            throw new AppError(
              422,
              "past_event",
              "please choose a future time",
            );
          const action: Action = {
            id: randomUUID(),
            sessionId: id,
            event,
            status: "pending",
            expiresAt: Date.now() + 600000,
          };
          this.store.transaction(() => {
            supersede();
            this.store.put("action", action.id, action);
          });
          const when = new Intl.DateTimeFormat("en-GB", {
            timeZone: event.timeZone,
            dateStyle: "medium",
            timeStyle: "short",
          });
          result = this.result(id, "approval", "add event? tap yes", {
            action,
            speechText: `add ${event.title} on ${when.format(new Date(event.start))} until ${when.format(new Date(event.end))}, ${event.timeZone}?`,
          });
        } else if (plan.kind === "list_events") {
          this.emit(id, "search", "checking Calendar…");
          const events = await this.calendar.list(plan.window);
          supersede();
          result = this.result(
            id,
            "speak",
            events.length
              ? `found ${events.length} events`
              : "no events in that time",
            { data: events },
          );
        } else if (plan.kind === "availability") {
          this.emit(id, "search", "checking availability…");
          const busy = await this.calendar.busy(plan.window);
          supersede();
          result = this.result(
            id,
            "speak",
            busy.length ? "here are the busy times" : "that time is free",
            { data: { window: plan.window, busy } },
          );
        } else {
          supersede();
          result = this.result(
            id,
            plan.kind === "clarify" ? "clarify" : "speak",
            plan.text,
          );
        }
        session.messages = [
          ...messages,
          {
            role: "assistant" as const,
            content: JSON.stringify({ plan, result }).slice(0, 8000),
          },
        ].slice(-16);
        this.store.transaction(() => {
          this.store.put("session", id, session);
          this.store.put("turn", key, { hash, status: "done", result });
        });
        return result;
      } catch (error) {
        this.store.put("turn", key, { hash, status: "failed" });
        this.emit(id, "error", "couldn’t complete that request");
        throw error;
      }
    });
  }
  action(sessionId: string, actionId: string) {
    this.session(sessionId);
    const a = this.store.get<Action>("action", actionId);
    if (!a || a.sessionId !== sessionId)
      throw new AppError(404, "not_found", "action not found");
    return a;
  }
  private rememberAction(action: Action) {
    const session = this.session(action.sessionId);
    session.messages = [
      ...session.messages,
      {
        role: "assistant" as const,
        content: JSON.stringify({
          actionId: action.id,
          status: action.status,
          receipt: action.receipt,
        }),
      },
    ].slice(-16);
    this.store.put("session", session.id, session);
  }
  async decide(
    sessionId: string,
    actionId: string,
    decision: "confirm" | "cancel",
  ) {
    return this.locked(sessionId, async () => {
      const action = this.action(sessionId, actionId);
      if (action.status === "completed" && decision === "cancel")
        throw new AppError(
          409,
          "already_completed",
          "already saved; cancellation here does not delete Calendar events",
        );
      if (action.status === "completed")
        return this.result(
          sessionId,
          "happy",
          `added · ${action.event.title}`,
          {
            action,
            data: action.receipt,
            returnTo: { state: "idle", afterMs: 2400 },
          },
        );
      if (decision === "cancel") {
        if (action.status !== "pending")
          throw new AppError(
            409,
            "cannot_cancel",
            "this action may already have been saved; check Calendar",
          );
        action.status = "cancelled";
        this.store.put("action", action.id, action);
        this.rememberAction(action);
        return this.result(
          sessionId,
          "cancelled",
          "cancelled · nothing changed",
          { action },
        );
      }
      if (action.status === "cancelled" || action.status === "expired")
        throw new AppError(
          409,
          "action_closed",
          "this proposal is no longer active",
        );
      if (action.status === "pending" && action.expiresAt < Date.now()) {
        action.status = "expired";
        this.store.put("action", action.id, action);
        throw new AppError(
          409,
          "approval_expired",
          "ask again to refresh this proposal",
        );
      }
      action.status = "executing";
      this.store.put("action", action.id, action);
      this.emit(sessionId, "working", "adding your event…");
      try {
        action.receipt = await this.calendar.create(action.id, action.event);
        action.status = "completed";
        this.store.put("action", action.id, action);
        this.rememberAction(action);
        return this.result(
          sessionId,
          "happy",
          `added · ${action.event.title}`,
          {
            action,
            data: action.receipt,
            returnTo: { state: "idle", afterMs: 2400 },
          },
        );
      } catch (error) {
        action.status = "uncertain";
        this.store.put("action", action.id, action);
        this.emit(sessionId, "error", "save not verified · retry to check");
        throw error;
      }
    });
  }
  async deleteSession(id: string) {
    return this.locked(id, async () => {
      this.session(id);
      if (
        this.store
          .list<Action>("action")
          .some(
            (r) =>
              r.value.sessionId === id &&
              ["executing", "uncertain"].includes(r.value.status),
          )
      )
        throw new AppError(
          409,
          "unresolved_action",
          "resolve the unverified save before deleting its receipt",
        );
      this.store.transaction(() => {
        for (const { id: key, value } of this.store.list<Action>("action"))
          if (value.sessionId === id) this.store.delete("action", key);
        for (const { id: key } of this.store.list("turn"))
          if (key.startsWith(id + ":")) this.store.delete("turn", key);
        this.store.delete("timeline", id);
        this.store.delete("session", id);
      });
    });
  }
}
