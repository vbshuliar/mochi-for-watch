import type { Config } from "./config.ts";
import type { Store } from "./store.ts";
import type { CallAction } from "./calls.ts";

export type ReadinessCheck = {
  id: string;
  title: string;
  status: "ready" | "needs_setup" | "blocked" | "unverified";
  detail: string;
};
type Options = {
  config: Config;
  store: Store;
  calendarConnected: boolean;
  calendarEnabled: boolean;
  callsConfigured: boolean;
  pushConfigured: boolean;
  profilePhoneNumber?: string;
  revision?: string;
  dailyCallLimit?: number;
  now?: number;
};
export function buildReadiness(options: Options) {
  const now = options.now ?? Date.now();
  const callLimit = options.dailyCallLimit ?? options.config.DAILY_CALL_LIMIT;
  const revision = options.revision ?? options.config.BUILD_REVISION;
  const periodStart = new Date(now);
  periodStart.setUTCHours(0, 0, 0, 0);
  const calls = options.store.list<CallAction>("call").map((row) => row.value);
  const attempts = calls.filter(
    (call) =>
      call.startedAt !== undefined &&
      call.startedAt >= periodStart.getTime() &&
      call.startedAt <= now,
  );
  const attemptIds = new Set(attempts.map((call) => call.id));
  for (const row of options.store.list<{ startedAt: number }>("call-attempt"))
    if (
      row.value.startedAt >= periodStart.getTime() &&
      row.value.startedAt <= now
    )
      attemptIds.add(row.id);
  const callAttempts = attemptIds.size;
  const activeCalls = calls.filter((call) =>
    ["starting", "queued", "in_progress"].includes(call.status),
  ).length;
  const unverifiedCalls = calls.filter(
    (call) => call.status === "uncertain",
  ).length;
  const allowed = options.config.TWILIO_ALLOWED_NUMBERS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const live = options.config.APP_MODE === "live";
  const checks: ReadinessCheck[] = [
    {
      id: "mode",
      title: "Live backend",
      status: live ? "ready" : "blocked",
      detail: live
        ? "Live mode is enabled."
        : "Simulation cannot prove a real booking.",
    },
    {
      id: "model",
      title: "Conversation",
      status: live && options.config.MODEL_API_KEY ? "ready" : "needs_setup",
      detail:
        "Configuration check only; model access and balance are not tested here.",
    },
    {
      id: "voice",
      title: "Speaking voice",
      status: options.config.ELEVENLABS_API_KEY ? "ready" : "needs_setup",
      detail: "Configuration check only; audio delivery is not tested here.",
    },
    {
      id: "calendar",
      title: "Calendar availability",
      status:
        options.calendarConnected && options.calendarEnabled
          ? "ready"
          : "needs_setup",
      detail: !options.calendarEnabled
        ? "Calendar is switched off."
        : options.calendarConnected
          ? "Calendar is connected; this check does not read or change events."
          : "Connect Calendar to check your available times.",
    },
    {
      id: "calling",
      title: "Calling",
      status: options.callsConfigured ? "ready" : "needs_setup",
      detail: "Checks configuration only. No call is placed.",
    },
    {
      id: "recipient",
      title: "Usual booking destination",
      status: !options.profilePhoneNumber
        ? "needs_setup"
        : allowed.includes(options.profilePhoneNumber)
          ? "ready"
          : "needs_setup",
      detail: !options.profilePhoneNumber
        ? "Save your usual booking profile."
        : allowed.includes(options.profilePhoneNumber)
          ? "The profile destination is enabled for calling. Recipient readiness still needs confirming."
          : "The saved destination is not enabled for calling. Ask the deployment owner to review it.",
    },
    {
      id: "active_calls",
      title: "Existing calls",
      status: activeCalls || unverifiedCalls ? "blocked" : "ready",
      detail: unverifiedCalls
        ? "Resolve unverified call outcomes before another call or deployment."
        : activeCalls
          ? "Wait for the active call to finish before deploying or placing another call."
          : "No active or unverified call blocks the next approved booking.",
    },
    {
      id: "notifications",
      title: "Completion alerts",
      status: options.pushConfigured ? "ready" : "needs_setup",
      detail: options.pushConfigured
        ? "Push credentials are configured; device permission and actual delivery still need verification."
        : "Apple push provisioning is missing. In-app updates remain available.",
    },
    {
      id: "live_acceptance",
      title: "Complete booking demonstration",
      status: "unverified",
      detail:
        "A configured backend is not proof of a completed real booking. Verify the recipient's confirmation and Calendar result in an approved acceptance run.",
    },
    {
      id: "device_acceptance",
      title: "Watch and iPhone",
      status: "unverified",
      detail:
        "Installation, voice routing, background behavior and device notification delivery need an on-device check.",
    },
  ];
  checks.push({
    id: "call_budget",
    title: "Daily call limit",
    status: callAttempts >= callLimit ? "blocked" : "ready",
    detail: `${callAttempts} of ${callLimit} call attempts used today (UTC). This is an attempt limit, not a billing cap.`,
  });
  return {
    revision:
      revision && /^[a-zA-Z0-9._-]{1,100}$/.test(revision)
        ? revision
        : "unknown",
    mode: options.config.APP_MODE,
    checkedAt: now,
    configurationReady: checks
      .filter(
        (check) =>
          !["notifications", "live_acceptance", "device_acceptance"].includes(
            check.id,
          ),
      )
      .every((check) => check.status === "ready"),
    readyForDemo: false,
    checks,
    usage: {
      periodStart: periodStart.toISOString(),
      callAttempts,
      callLimit,
      remainingCalls: Math.max(0, callLimit - callAttempts),
      activeCalls,
      unverifiedCalls,
      completedCalls: attempts.filter((call) => call.status === "completed")
        .length,
      callDurationSeconds: Math.floor(
        attempts.reduce(
          (total, call) =>
            total +
            (call.finishedAt && call.startedAt
              ? Math.max(0, call.finishedAt - call.startedAt)
              : 0),
          0,
        ) / 1000,
      ),
      estimatedCost: null,
      notes:
        "Elapsed task duration is not billed telephone duration. Provider prices, token/audio usage and actual charges are not available in this report.",
    },
  };
}
