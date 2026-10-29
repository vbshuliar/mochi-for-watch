import { DatabaseSync, backup } from "node:sqlite";
import { createDecipheriv } from "node:crypto";
import {
  closeSync,
  openSync,
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { Store } from "./store.ts";

const day = 86400000;
type RecordValue = {
  status?: string;
  callId?: string;
  expiresAt?: number;
  createdAt?: number;
};
const disposableCall = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "stopped",
]);
export function cleanupEphemeral(
  store: Store,
  options: { apply?: boolean; now?: number } = {},
) {
  const now = options.now ?? Date.now();
  return store.transaction(() => {
    const candidates: Array<{ kind: string; id: string }> = [];
    for (const row of store.list<RecordValue>("call-audio")) {
      const call = row.value.callId
        ? store.get<RecordValue>("call", row.value.callId)
        : undefined;
      if (
        typeof row.value.expiresAt === "number" &&
        row.value.expiresAt < now - day &&
        (!call || disposableCall.has(call.status ?? ""))
      )
        candidates.push({ kind: "call-audio", id: row.id });
    }
    for (const row of store.list<RecordValue>("push-delivery"))
      if (
        ["accepted", "failed"].includes(row.value.status ?? "") &&
        typeof row.value.createdAt === "number" &&
        row.value.createdAt < now - 7 * day
      )
        candidates.push({ kind: "push-delivery", id: row.id });
    // Credentials, histories, provider receipts, pending OAuth state and approval records
    // are deliberately outside this narrow policy, including all uncertain operations.
    const counts: Record<string, number> = {};
    for (const candidate of candidates) {
      counts[candidate.kind] = (counts[candidate.kind] ?? 0) + 1;
      if (options.apply === true) store.delete(candidate.kind, candidate.id);
    }
    return {
      applied: options.apply === true,
      checkedAt: now,
      candidates: candidates.length,
      counts,
      policy:
        "Expired call audio older than 24 hours for resolved calls; accepted/failed push deliveries older than 7 days. All other records retained.",
    };
  });
}

function verifyDatabase(database: DatabaseSync, key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error("A valid ENCRYPTION_KEY is required.");
  const check = database.prepare("PRAGMA quick_check").get() as {
    quick_check: string;
  };
  if (check.quick_check !== "ok")
    throw new Error("Database integrity check failed.");
  const rows = database.prepare("SELECT value FROM records").all() as Array<{
    value: string;
  }>;
  for (const row of rows) {
    const bytes = Buffer.from(row.value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "hex"),
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
  }
  return rows.length;
}

/** Online SQLite backup includes committed WAL data. Destination must be new. */
export async function createEncryptedBackup(
  source: string,
  destination: string,
  key: string,
) {
  if (source === ":memory:" || !existsSync(source))
    throw new Error("Choose an existing on-disk database.");
  const target = resolve(destination);
  if (resolve(source) === target)
    throw new Error("Backup destination must differ from source.");
  if (
    existsSync(target) ||
    existsSync(target + "-wal") ||
    existsSync(target + "-shm")
  )
    throw new Error("Destination already exists; no files were overwritten.");
  const database = new DatabaseSync(source, { readOnly: true });
  let owned = false;
  try {
    verifyDatabase(database, key);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    closeSync(openSync(target, "wx", 0o600));
    owned = true;
    await backup(database, target);
    chmodSync(target, 0o600);
    const restored = new DatabaseSync(target, { readOnly: true });
    try {
      return { records: verifyDatabase(restored, key), verified: true };
    } finally {
      restored.close();
    }
  } catch (error) {
    if (owned)
      for (const suffix of ["", "-wal", "-shm"])
        rmSync(target + suffix, { force: true });
    throw error;
  } finally {
    database.close();
  }
}

/** Restore is always to a new path; switching a stopped service is a separate operator step. */
export async function restoreEncryptedBackup(
  source: string,
  destination: string,
  key: string,
) {
  return createEncryptedBackup(source, destination, key);
}
