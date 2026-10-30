import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { AppError } from "./domain.ts";
import type { Store } from "./store.ts";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
type Ticket = { name: string; expiresAt: number };
type Device = {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  tokenHash: string;
};
export class Pairing {
  constructor(
    private store: Store,
    private ownerToken: string,
    private now: () => number = Date.now,
  ) {}
  isOwner(token: string) {
    const a = Buffer.from(token),
      b = Buffer.from(this.ownerToken);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  authorized(token: string) {
    if (this.isOwner(token)) return true;
    if (!/^(?:mochi|jolly)_[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const device = this.store.get<Device>("paired-device", digest(token));
    return !!device && device.expiresAt > this.now();
  }
  issue(input: unknown) {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(input);
    for (const row of this.store.list<Ticket>("pairing-ticket"))
      if (row.value.expiresAt <= this.now())
        this.store.delete("pairing-ticket", row.id);
    if (this.store.list("pairing-ticket").length >= 5)
      throw new AppError(
        429,
        "pairing_limit",
        "Wait for an existing pairing code to expire.",
      );
    const code = [...randomBytes(16)].map((b) => alphabet[b % 32]).join("");
    const expiresAt = this.now() + 5 * 60000;
    this.store.put("pairing-ticket", digest(code), {
      name,
      expiresAt,
    } satisfies Ticket);
    return { code: code.match(/.{4}/g)!.join("-"), expiresAt };
  }
  redeem(input: unknown) {
    const { code } = z
      .object({ code: z.string().max(80) })
      .strict()
      .parse(input);
    const normalized = code.replace(/[\s-]/g, "").toUpperCase();
    return this.store.transaction(() => {
      const key = digest(normalized),
        ticket = this.store.get<Ticket>("pairing-ticket", key);
      if (
        !/^[A-HJ-NP-Z2-9]{16}$/.test(normalized) ||
        !ticket ||
        ticket.expiresAt <= this.now()
      )
        throw new AppError(
          401,
          "invalid_pairing_code",
          "This code is invalid or expired. Request a new code.",
        );
      if (this.list().length >= 20)
        throw new AppError(
          409,
          "device_limit",
          "Remove an old paired device first.",
        );
      const token = "mochi_" + randomBytes(32).toString("base64url"),
        id = randomUUID(),
        expiresAt = this.now() + 90 * 86400000;
      const tokenHash = digest(token);
      this.store.put("paired-device", tokenHash, {
        id,
        name: ticket.name,
        createdAt: this.now(),
        expiresAt,
        tokenHash,
      } satisfies Device);
      this.store.delete("pairing-ticket", key);
      return { token, deviceId: id, expiresAt };
    });
  }
  list() {
    return this.store
      .list<Device>("paired-device")
      .filter((r) => r.value.expiresAt > this.now())
      .map(({ value: { tokenHash: _hash, ...device } }) => device);
  }
  expiredPushes() {
    const pushes: string[] = [];
    for (const row of this.store.list<Device>("paired-device"))
      if (row.value.expiresAt <= this.now())
        pushes.push(...this.revoke(row.value.id));
    return pushes;
  }
  bindPush(token: string, pushId: string) {
    // A persistent installation ID may be re-paired; only its current grant owns alerts.
    for (const row of this.store.list<{ pushId: string }>("paired-push"))
      if (row.value.pushId === pushId) this.store.delete("paired-push", row.id);
    const device = this.store.get<Device>("paired-device", digest(token));
    if (device)
      this.store.put("paired-push", `${device.id}:${pushId}`, {
        deviceId: device.id,
        pushId,
      });
  }
  revoke(id: string) {
    z.uuid().parse(id);
    for (const row of this.store.list<Device>("paired-device"))
      if (row.value.id === id) this.store.delete("paired-device", row.id);
    const pushes: string[] = [];
    for (const row of this.store.list<{ deviceId: string; pushId: string }>(
      "paired-push",
    ))
      if (row.value.deviceId === id) {
        pushes.push(row.value.pushId);
        this.store.delete("paired-push", row.id);
      }
    return pushes;
  }
}
