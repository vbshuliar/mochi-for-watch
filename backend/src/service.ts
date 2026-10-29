import { randomUUID, createHash } from "node:crypto";
import {
  AppError,
  memoryInputSchema,
  type Memory,
  eventSchema,
  planSchema,
  type Action,
  type Calendar,
  type Planner,
  type Session,
  type Timeline,
  type TurnResult,
} from "./domain.ts";
import type { Calls, CallAction } from "./calls.ts";
import type { Workflows } from "./workflows.ts";
import type { SocialWorkflow } from "./social-workflow.ts";
import { Store } from "./store.ts";
import type { Reminders } from "./reminders.ts";
import type { Briefing } from "./briefing.ts";
import type { GmailDrafts, GmailDraftAction } from "./gmail-drafts.ts";
type CachedTurn = {
  hash: string;
  status: "processing" | "done" | "failed" | "cancelled";
  result?: TurnResult;
};
export class Service {
  private locks = new Set<string>();
  private activeTurns = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  async cancelTurn(id: string, requestId: string) {
    this.session(id);
    const key = `${id}:${requestId}`,
      active = this.activeTurns.get(key);
    if (active) {
      active.controller.abort();
      await active.done;
      return { cancelled: true };
    }
    const cached = this.store.get<CachedTurn>("turn", key);
    if (cached?.status === "done") return { cancelled: false, completed: true };
    this.store.put("turn", key, {
      hash: cached?.hash || "",
      status: "cancelled",
    });
    return { cancelled: true };
  }
  constructor(
    readonly store: Store,
    private planner: Planner,
    private calendar: Calendar,
    readonly simulated: boolean,
    private workflows?: Workflows,
    private calls?: Calls,
    private social?: SocialWorkflow,
    private daily?: {
      reminders: Reminders;
      briefing: Briefing;
      drafts: GmailDrafts;
    },
  ) {
    for (const { id, value } of store.list<Action>("action"))
      if (value.status === "executing")
        store.put("action", id, { ...value, status: "uncertain" });
    for (const { id, value } of store.list<CachedTurn>("turn"))
      if (value.status === "processing")
        store.put("turn", id, { ...value, status: "failed" });
  }
  memories(): Memory[] {
    return this.store
      .list<Memory>("memory")
      .map((item) => item.value)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  private resetMemoryContext(exceptTurn?: string) {
    // Editing/forgetting must not leave stale facts in another device's context.
    for (const [key, turn] of this.activeTurns)
      if (key !== exceptTurn) turn.controller.abort();
    for (const { id, value } of this.store.list<Session>("session"))
      this.store.put("session", id, { ...value, messages: [] });
  }
  saveMemory(input: unknown, id?: string, exceptTurn?: string): Memory {
    const fields = memoryInputSchema.parse(input);
    if (id && !this.store.get("memory", id))
      throw new AppError(
        404,
        "memory_not_found",
        "that memory no longer exists",
      );
    const duplicate =
      !id &&
      this.memories().find(
        (m) => m.title.toLowerCase() === fields.title.toLowerCase(),
      );
    if (
      id &&
      this.memories().some(
        (m) =>
          m.id !== id && m.title.toLowerCase() === fields.title.toLowerCase(),
      )
    )
      throw new AppError(
        409,
        "memory_title_conflict",
        "another memory already uses that title",
      );
    const target = id || (duplicate ? duplicate.id : undefined);
    if (!target && this.memories().length >= 50)
      throw new AppError(
        409,
        "memory_full",
        "memory is full; remove a memory in the iPhone app first",
      );
    const memory = {
      ...fields,
      id: target || randomUUID(),
      updatedAt: Date.now(),
    };
    this.store.transaction(() => {
      this.store.put("memory", memory.id, memory);
      this.resetMemoryContext(exceptTurn);
    });
    return memory;
  }
  deleteMemory(id?: string, exceptTurn?: string) {
    if (id && !this.store.get("memory", id))
      throw new AppError(
        404,
        "memory_not_found",
        "that memory no longer exists",
      );
    this.store.transaction(() => {
      for (const memory of this.memories())
        if (!id || memory.id === id) this.store.delete("memory", memory.id);
      this.resetMemoryContext(exceptTurn);
    });
  }
  private requireCalendarEnabled() {
    if (this.store.get<boolean>("integration", "calendar-enabled") === false)
      throw new AppError(
        409,
        "calendar_disabled",
        "Calendar is switched off. Enable it in connections to use it.",
      );
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
    options: { signal?: AbortSignal; onText?: (text: string) => void } = {},
  ) {
    return this.locked(id, async () => {
      const session = this.session(id),
        key = `${id}:${requestId}`,
        hash = createHash("sha256")
          .update("text" in input ? "text:" + input.text : input.audio)
          .digest("hex");
      const cached = this.store.get<CachedTurn>("turn", key);
      if (cached?.status === "cancelled" || options.signal?.aborted)
        throw new AppError(409, "turn_cancelled", "request cancelled");
      if (cached && cached.hash !== hash)
        throw new AppError(
          409,
          "idempotency_conflict",
          "use a new request ID for different input",
        );
      if (cached?.status === "done") return cached.result!;
      this.store.put("turn", key, { hash, status: "processing" });
      const controller = new AbortController();
      const signal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      let release!: () => void;
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.activeTurns.set(key, { controller, done });
      const check = () => {
        if (signal.aborted)
          throw new AppError(409, "turn_cancelled", "request cancelled");
      };
      try {
        check();
        let text: string;
        if ("text" in input) text = input.text;
        else {
          this.emit(id, "transcribe", "making sense of your words…");
          text = await this.planner.transcribe(input.audio, signal);
        }
        check();
        this.emit(id, "think", "thinking…");
        const messages = [
          ...session.messages,
          { role: "user" as const, content: text },
        ].slice(-16);
        const memories = this.memories();
        const latestCall = this.calls?.listAll()[0];
        const plan = planSchema.parse(
          /^(?:how(?:’s|'s| is) (?:the |my )?(?:booking|call)(?: going)?|(?:is|has) (?:the |my )?(?:booking|call) (?:done|finished|completed)|did (?:they|the business) (?:answer|confirm|book it)|what(?:’s|'s| is) (?:the )?(?:call|booking) (?:status|progress))\??$/i.test(
            text.trim(),
          )
            ? { kind: "call_status" }
            : await this.planner.plan(messages, session.timeZone, {
                signal,
                onText: options.onText,
                memories,
                reminders: this.daily?.reminders
                  .list()
                  .slice(0, 50)
                  .map(({ id, title, dueAt, status }) => ({
                    id,
                    title,
                    dueAt,
                    status,
                  })),
                latestCall: latestCall
                  ? {
                      id: latestCall.id,
                      status: latestCall.status,
                      progress: latestCall.progress?.text,
                      summary: latestCall.summary,
                      destinationName: latestCall.booking.destinationName,
                    }
                  : undefined,
              }),
        );
        check();
        if (["create_event", "list_events", "availability"].includes(plan.kind))
          this.requireCalendarEnabled();
        let result: TurnResult;
        // A new request supersedes earlier unapproved proposals in this session.
        const supersede = () => {
          this.workflows?.supersede(id);
          for (const { id: actionId, value } of this.store.list<Action>(
            "action",
          ))
            if (value.sessionId === id && value.status === "pending")
              this.store.put("action", actionId, {
                ...value,
                status: "cancelled",
              });
        };
        if (plan.kind === "daily_briefing") {
          if (!this.daily)
            throw new AppError(
              503,
              "unavailable",
              "Daily briefing is unavailable.",
            );
          const briefing = await this.daily.briefing.get(
            session.timeZone,
            signal,
          );
          check();
          result = this.result(id, "speak", "your day", {
            speechText: briefing.summary,
            data: briefing,
          });
        } else if (plan.kind === "list_reminders") {
          if (!this.daily)
            throw new AppError(
              503,
              "unavailable",
              "Reminders are unavailable.",
            );
          const reminders = this.daily.reminders
            .list()
            .filter((r) => r.status === "pending");
          result = this.result(
            id,
            "speak",
            reminders.length
              ? `${reminders.length} reminders`
              : "No pending reminders.",
            {
              speechText: reminders.length
                ? reminders
                    .slice(0, 3)
                    .map(
                      (r) =>
                        `${r.title}, ${new Intl.DateTimeFormat("en-GB", { timeZone: r.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(r.dueAt))}`,
                    )
                    .join(". ")
                : "You have no pending reminders.",
              data: { reminders },
            },
          );
        } else if (plan.kind === "create_reminder") {
          if (!this.daily)
            throw new AppError(
              503,
              "unavailable",
              "Reminders are unavailable.",
            );
          if (
            plan.reminder.sourceCallId &&
            !this.calls
              ?.listAll()
              .some((c) => c.id === plan.reminder.sourceCallId)
          )
            throw new AppError(404, "not_found", "Booking not found.");
          const reminder = this.daily.reminders.create({
            ...plan.reminder,
            id: requestId,
          });
          result = this.result(
            id,
            "happy",
            `Reminder saved: ${reminder.title}`,
            { data: { reminder }, returnTo: { state: "idle", afterMs: 2400 } },
          );
        } else if (plan.kind === "update_reminder") {
          if (!this.daily)
            throw new AppError(
              503,
              "unavailable",
              "Reminders are unavailable.",
            );
          const reminder = this.daily.reminders.update(plan.id, plan.changes);
          result = this.result(
            id,
            "happy",
            reminder.status === "completed"
              ? `Completed: ${reminder.title}`
              : `Reminder updated: ${reminder.title}`,
            { data: { reminder }, returnTo: { state: "idle", afterMs: 2400 } },
          );
        } else if (plan.kind === "gmail_draft") {
          if (!this.daily)
            throw new AppError(
              503,
              "unavailable",
              "Gmail drafts are unavailable.",
            );
          const action = this.daily.drafts.prepare(id, plan.draft);
          result = this.draftResult(id, action);
        } else if (plan.kind === "call_status") {
          result =
            this.calls?.statusReply(id) ??
            this.result(id, "speak", "No booking call has been started.");
        } else if (plan.kind === "change_booking") {
          if (!this.calls)
            throw new AppError(
              409,
              "calls_unavailable",
              "Booking calls are unavailable.",
            );
          const source = this.calls
            .listAll()
            .find((call) => call.id === plan.callId);
          if (!source)
            throw new AppError(404, "not_found", "Booking not found.");
          result = await this.calls.prepareChange(
            source.sessionId,
            source.id,
            plan.change,
            signal,
          );
          result = { ...result, sessionId: id };
          check();
        } else if (plan.kind === "call_booking") {
          if (!this.calls)
            throw new AppError(
              409,
              "calls_unavailable",
              "Booking calls are not configured yet.",
            );
          const phoneSources = [
            ...messages.filter((m) => m.role === "user").map((m) => m.content),
            ...memories.map((memory) => `${memory.title} ${memory.text}`),
          ];
          const supplied = phoneSources.some((content) =>
            (
              content
                .replace(/[\s().-]/g, "")
                .match(/\+[1-9]\d{7,14}(?!\d)/g) || []
            ).some((number) => number === plan.booking.phoneNumber),
          );
          if (!supplied)
            throw new AppError(
              422,
              "phone_required",
              "Please provide the destination phone number, including country code.",
            );
          this.calls.supersede(id);
          supersede();
          result = await this.calls.prepare(id, plan.booking, signal);
          check();
        } else if (plan.kind === "social_task") {
          if (!this.social)
            throw new AppError(
              503,
              "connection_unavailable",
              "this connection isn’t available yet",
            );
          result = await this.social.prepare(
            id,
            plan.provider,
            plan.instruction,
            signal,
          );
          check();
          supersede();
        } else if (plan.kind === "workspace_task") {
          if (!this.workflows)
            throw new AppError(
              503,
              "workflow_unavailable",
              "this connection isn’t available yet",
            );
          supersede();
          result = await this.workflows.prepare(id, plan, signal);
          check();
        } else if (plan.kind === "remember") {
          supersede();
          const memory = this.saveMemory(plan.memory, plan.id, key);
          result = this.result(id, "speak", `I’ll remember: ${memory.text}`, {
            data: { memory },
          });
        } else if (plan.kind === "forget") {
          supersede();
          this.deleteMemory(plan.id, key);
          result = this.result(id, "speak", "that memory is forgotten");
        } else if (plan.kind === "create_event") {
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
          const events = await this.calendar.list(plan.window, signal);
          check();
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
          const busy = await this.calendar.busy(plan.window, signal);
          check();
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
            plan.kind === "reply" && plan.sources
              ? { sources: plan.sources }
              : {},
          );
        }
        session.messages =
          plan.kind === "remember" || plan.kind === "forget"
            ? []
            : [
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
        this.store.put("turn", key, {
          hash,
          status: signal.aborted ? "cancelled" : "failed",
        });
        this.emit(
          id,
          signal.aborted ? "cancelled" : "error",
          signal.aborted
            ? "request cancelled"
            : "couldn’t complete that request",
        );
        throw error;
      } finally {
        this.activeTurns.delete(key);
        release();
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
  draftResult(sessionId: string, action: GmailDraftAction): TurnResult {
    const completed = action.status === "completed",
      cancelled = action.status === "cancelled";
    return this.result(
      sessionId,
      completed ? "happy" : cancelled ? "idle" : "approval",
      completed
        ? "Draft saved in Gmail · not sent"
        : cancelled
          ? "Draft cancelled"
          : action.status === "uncertain"
            ? "Draft save unverified · review to check"
            : "Review email draft",
      {
        gmailDraftAction: action,
        speechText: completed
          ? "The draft is saved in Gmail. It has not been sent."
          : cancelled
            ? "Draft cancelled. Nothing was sent."
            : `Review the draft to ${action.to} before saving it to Gmail. Nothing will be sent.`,
      },
    );
  }
  async decideDraft(
    sessionId: string,
    id: string,
    decision: "confirm" | "cancel",
  ) {
    this.session(sessionId);
    if (!this.daily)
      throw new AppError(503, "unavailable", "Gmail drafts are unavailable.");
    return this.locked(sessionId, async () => {
      this.session(sessionId);
      const action = await this.daily!.drafts.decide(sessionId, id, decision);
      return this.draftResult(sessionId, action);
    });
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
          `${action.operation === "delete" ? "removed" : action.operation === "update" ? "updated" : "added"} · ${action.event.title}`,
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
      this.requireCalendarEnabled();
      const linkedCall = this.store
        .list<CallAction>("call")
        .map((r) => r.value)
        .find((call) => call.calendarActionId === action.id);
      if (
        linkedCall &&
        (linkedCall.supersededBy ||
          this.store
            .list<CallAction>("call")
            .some(
              ({ value }) =>
                value.sourceCallId === linkedCall.id &&
                ["starting", "queued", "in_progress", "uncertain"].includes(
                  value.status,
                ),
            ))
      )
        throw new AppError(
          409,
          "booking_changed",
          "A booking change is active or completed. Review its result before changing Calendar.",
        );
      action.status = "executing";
      this.store.put("action", action.id, action);
      this.emit(
        sessionId,
        "working",
        action.operation === "delete"
          ? "removing your event…"
          : action.operation === "update"
            ? "updating your event…"
            : "adding your event…",
      );
      try {
        if (action.operation) {
          if (
            !this.calendar.change ||
            !action.targetReceipt ||
            !action.sourceActionId
          )
            throw new AppError(
              409,
              "calendar_change_unavailable",
              "Calendar changes are unavailable.",
            );
          action.receipt = await this.calendar.change(
            action.id,
            action.sourceActionId,
            action.targetReceipt,
            action.operation,
            action.event,
          );
        } else
          action.receipt = await this.calendar.create(action.id, action.event);
        action.status = "completed";
        this.store.put("action", action.id, action);
        this.rememberAction(action);
        return this.result(
          sessionId,
          "happy",
          `${action.operation === "delete" ? "removed" : action.operation === "update" ? "updated" : "added"} · ${action.event.title}`,
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
  async decideDocument(
    sessionId: string,
    actionId: string,
    decision: "confirm" | "cancel",
  ) {
    return this.locked(sessionId, async () => {
      this.session(sessionId);
      if (!this.workflows)
        throw new AppError(
          503,
          "workflow_unavailable",
          "this connection isn’t available yet",
        );
      const result = await this.workflows.decide(sessionId, actionId, decision);
      const session = this.session(sessionId);
      session.messages = [
        ...session.messages,
        {
          role: "assistant" as const,
          content: JSON.stringify({
            status: result.state,
            text: result.speechText,
            sources: result.sources,
          }),
        },
      ].slice(-16);
      this.store.put("session", sessionId, session);
      return result;
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
      this.daily?.drafts.assertDeletable(id);
      this.workflows?.assertDeletable(id);
      this.calls?.assertDeletable(id);
      this.store.transaction(() => {
        this.daily?.drafts.deleteSession(id);
        this.workflows?.deleteSession(id);
        this.calls?.deleteSession(id);
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
