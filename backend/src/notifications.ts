import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect } from "node:http2";
import { z } from "zod";
import { AppError } from "./domain.ts";
import type { Reminder, ReminderOccurrence } from "./reminders.ts";
import type { Config } from "./config.ts";
import type { PublicCallAction } from "./calls.ts";
import { Store } from "./store.ts";

export const deviceSchema = z
  .object({
    id: z.uuid(),
    token: z
      .string()
      .regex(/^(?:[a-fA-F0-9]{2}){16,128}$/)
      .transform((s) => s.toLowerCase()),
    platform: z.enum(["ios", "watchos"]),
    environment: z.enum(["sandbox", "production"]),
  })
  .strict();
type Device = z.infer<typeof deviceSchema> & { registeredAt: number };
type Delivery = {
  deviceId: string;
  reminderId?: string;
  occurrenceDueAt?: string;
  taskId: string;
  sessionId: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  status: "pending" | "accepted" | "failed";
};
export type PushPayload = {
  aps: {
    alert: { title: string; body: string };
    sound: string;
    "thread-id": string;
  };
  taskId: string;
  sessionId: string;
  reminderId?: string;
};
export type PushTransport = (
  device: Device,
  payload: PushPayload,
) => Promise<{ status: number; reason?: string }>;
const day = 86_400_000;

// APNs acceptance is not proof of delivery. Persisted, bounded retries survive restart;
// the task collapse ID coalesces a repeated request after an ambiguous network failure.
export class Notifications {
  private key?: KeyObject;
  private jwt?: { value: string; createdAt: number };
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;
  private transport: PushTransport;

  constructor(
    private config: Config,
    private store: Store,
    transport?: PushTransport,
  ) {
    if (config.APNS_PRIVATE_KEY) {
      try {
        const key = createPrivateKey(
          config.APNS_PRIVATE_KEY.replace(/\\n/g, "\n"),
        );
        if (
          key.asymmetricKeyType === "ec" &&
          key.asymmetricKeyDetails?.namedCurve === "prime256v1"
        )
          this.key = key;
      } catch {
        /* Invalid provisioning is reported as unconfigured, never as delivery success. */
      }
    }
    this.transport =
      transport ?? ((device, payload) => this.send(device, payload));
  }
  configured(platform?: Device["platform"]) {
    const validTopic = (topic: string) =>
      /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(topic);
    const topicReady =
      platform === "ios"
        ? validTopic(this.config.APNS_TOPIC_IOS)
        : platform === "watchos"
          ? validTopic(this.config.APNS_TOPIC_WATCHOS)
          : validTopic(this.config.APNS_TOPIC_IOS) ||
            validTopic(this.config.APNS_TOPIC_WATCHOS);
    return Boolean(
      topicReady &&
      this.config.APP_MODE === "live" &&
      this.key &&
      /^[A-Z0-9]{10}$/.test(this.config.APNS_TEAM_ID) &&
      /^[A-Z0-9]{10}$/.test(this.config.APNS_KEY_ID),
    );
  }
  status() {
    return {
      configured: this.configured(),
      environment: this.config.APNS_ENVIRONMENT,
    };
  }
  register(input: unknown) {
    const value = deviceSchema.parse(input);
    if (value.environment !== this.config.APNS_ENVIRONMENT) {
      throw new AppError(
        409,
        "push_environment_mismatch",
        "This build's notification environment does not match the server.",
      );
    }
    const previous = this.store.get<Device>("push-device", value.id);
    const devices = this.store.list<Device>("push-device");
    if (!previous && devices.length >= 20)
      throw new AppError(
        409,
        "device_limit",
        "Remove an old notification device before adding another.",
      );
    // Re-registration is idempotent; tokens can rotate without duplicating alerts.
    for (const { id, value: other } of devices) {
      if (
        id !== value.id &&
        other.token === value.token &&
        other.platform === value.platform &&
        other.environment === value.environment
      )
        this.remove(id);
    }
    this.store.put("push-device", value.id, {
      ...value,
      registeredAt: previous?.registeredAt ?? Date.now(),
    });
    return { id: value.id, configured: this.configured(value.platform) };
  }
  remove(id: string) {
    this.store.delete("push-device", id);
    for (const row of this.store.list<Delivery>("push-delivery")) {
      if (row.value.deviceId === id) this.store.delete("push-delivery", row.id);
    }
  }
  enqueue(call: PublicCallAction) {
    if (
      !this.configured() ||
      !["completed", "failed", "uncertain", "stopped"].includes(call.status)
    )
      return;
    const now = Date.now();
    const occurredAt =
      call.finishedAt ?? call.updatedAt ?? call.startedAt ?? call.expiresAt;
    if (now - occurredAt > day) return;
    for (const { id: deviceId, value: device } of this.store.list<Device>(
      "push-device",
    )) {
      if (!this.configured(device.platform) || occurredAt < device.registeredAt)
        continue;
      const id = `${deviceId}:${call.id}:${call.status}:${call.outcome ?? "none"}`;
      if (!this.store.get("push-delivery", id))
        this.store.put("push-delivery", id, {
          deviceId,
          taskId: call.id,
          sessionId: call.sessionId,
          createdAt: now,
          attempts: 0,
          nextAttemptAt: now,
          status: "pending",
        } satisfies Delivery);
    }
  }
  enqueueReminder(occurrence: ReminderOccurrence) {
    if (!this.configured()) return;
    const now = Date.now();
    for (const { id: deviceId, value: device } of this.store.list<Device>(
      "push-device",
    )) {
      if (!this.configured(device.platform)) continue;
      const id = `${deviceId}:reminder:${occurrence.id}`;
      if (!this.store.get("push-delivery", id))
        this.store.put("push-delivery", id, {
          deviceId,
          taskId: occurrence.reminder.id,
          sessionId: "",
          reminderId: occurrence.reminder.id,
          occurrenceDueAt: occurrence.dueAt,
          createdAt: now,
          attempts: 0,
          nextAttemptAt: now,
          status: "pending",
        } satisfies Delivery);
    }
  }
  start() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => {
      void this.flush().catch(() =>
        console.error("Notification queue unavailable"),
      );
    }, 5000);
    this.timer.unref();
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    if (this.stopped || !this.configured()) return Promise.resolve();
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async drain() {
    const now = Date.now();
    const rows = this.store.list<Delivery>("push-delivery");
    for (const row of rows)
      if (now - row.value.createdAt > 7 * day)
        this.store.delete("push-delivery", row.id);
    const pending = rows
      .filter(
        (r) =>
          r.value.status === "pending" &&
          r.value.nextAttemptAt <= now &&
          now - r.value.createdAt <= 7 * day,
      )
      .slice(0, 20);
    for (const { id, value: delivery } of pending) {
      if (this.stopped) break;
      const device = this.store.get<Device>("push-device", delivery.deviceId);
      if (!device) {
        this.store.delete("push-delivery", id);
        continue;
      }
      if (now - delivery.createdAt > day) {
        this.store.put("push-delivery", id, { ...delivery, status: "failed" });
        continue;
      }
      if (delivery.reminderId) {
        const reminder = this.store.get<Reminder>(
          "reminder",
          delivery.reminderId,
        );
        // Recurrence advances dueAt after enqueue. lastDueAt ties this alert to
        // the durable occurrence; completing, snoozing or deleting invalidates it.
        if (
          !reminder ||
          reminder.status !== "pending" ||
          reminder.lastDueAt !== delivery.occurrenceDueAt
        ) {
          this.store.delete("push-delivery", id);
          continue;
        }
      }
      const payload: PushPayload = {
        aps: {
          alert: {
            title: delivery.reminderId
              ? "Mochi has a reminder"
              : "Mochi has a task update",
            body: delivery.reminderId
              ? "Open Mochi to review your reminder."
              : "Open Mochi to review the result or next step.",
          },
          sound: "default",
          "thread-id": delivery.taskId,
        },
        taskId: delivery.taskId,
        sessionId: delivery.sessionId,
        ...(delivery.reminderId ? { reminderId: delivery.reminderId } : {}),
      };
      let response: { status: number; reason?: string };
      try {
        response = await this.transport(device, payload);
      } catch {
        response = { status: 503 };
      }
      // Opt-out/token rotation can happen while APNs is responding.
      const current = this.store.get<Device>("push-device", device.id);
      if (!current || !this.store.get("push-delivery", id)) continue;
      if (current.token !== device.token) continue;
      if (
        response.status === 410 ||
        ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(
          response.reason ?? "",
        )
      ) {
        this.remove(device.id);
        continue;
      }
      delivery.attempts += 1;
      delivery.status =
        response.status === 200
          ? "accepted"
          : (response.status === 429 || response.status >= 500) &&
              delivery.attempts < 6
            ? "pending"
            : "failed";
      delivery.nextAttemptAt =
        Date.now() +
        Math.min(60 * 60_000, 30_000 * 2 ** (delivery.attempts - 1));
      this.store.put("push-delivery", id, delivery);
    }
  }
  private authorization() {
    const now = Date.now();
    if (this.jwt && now - this.jwt.createdAt < 40 * 60_000)
      return this.jwt.value;
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const body = `${encode({ alg: "ES256", kid: this.config.APNS_KEY_ID })}.${encode({ iss: this.config.APNS_TEAM_ID, iat: Math.floor(now / 1000) })}`;
    const signature = sign("sha256", Buffer.from(body), {
      key: this.key!,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    this.jwt = { value: `${body}.${signature}`, createdAt: now };
    return this.jwt.value;
  }
  private send(
    device: Device,
    payload: PushPayload,
  ): ReturnType<PushTransport> {
    const origin =
      device.environment === "production"
        ? "https://api.push.apple.com"
        : "https://api.sandbox.push.apple.com";
    const topic =
      device.platform === "ios"
        ? this.config.APNS_TOPIC_IOS
        : this.config.APNS_TOPIC_WATCHOS;
    return new Promise((resolve, reject) => {
      const session = connect(origin);
      let settled = false;
      const finish = (
        result?: { status: number; reason?: string },
        error?: Error,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        session.destroy();
        if (error) reject(error);
        else resolve(result!);
      };
      const timeout = setTimeout(
        () => finish(undefined, new Error("APNs timeout")),
        10_000,
      );
      session.on("error", () =>
        finish(undefined, new Error("APNs unavailable")),
      );
      const request = session.request({
        ":method": "POST",
        ":path": `/3/device/${device.token}`,
        authorization: `bearer ${this.authorization()}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
        "apns-collapse-id": payload.taskId,
      });
      let status = 503,
        body = "";
      request.setEncoding("utf8");
      request.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      request.on("data", (chunk) => {
        if (body.length < 8192) body += chunk;
      });
      request.on("error", () =>
        finish(undefined, new Error("APNs request failed")),
      );
      request.on("end", () => {
        let reason: string | undefined;
        try {
          reason = JSON.parse(body).reason;
        } catch {
          /* Successful responses have no body. */
        }
        finish({ status, reason });
      });
      request.end(JSON.stringify(payload));
    });
  }
  async close() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
