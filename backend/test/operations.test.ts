import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { readConfig } from "../src/config.ts";
import {
  cleanupEphemeral,
  createEncryptedBackup,
  restoreEncryptedBackup,
} from "../src/maintenance.ts";
import { buildReadiness } from "../src/readiness.ts";
const key = "b".repeat(64);
const now = Date.parse("2030-03-31T12:00:00Z");
const config = readConfig({
  API_TOKEN: "a".repeat(64),
  ENCRYPTION_KEY: key,
  DATABASE_PATH: ":memory:",
  APP_MODE: "live",
  MODEL_API_KEY: "model-private-value",
  ELEVENLABS_API_KEY: "voice-private-value",
  TWILIO_ALLOWED_NUMBERS: "+447700900123",
});
test("readiness separates configured from verified and never returns credentials or recipient", (t) => {
  const store = new Store(":memory:", key);
  t.after(() => store.close());
  const result = buildReadiness({
    config,
    store,
    calendarConnected: true,
    calendarEnabled: true,
    callsConfigured: true,
    pushConfigured: true,
    profilePhoneNumber: "+447700900123",
    revision: "abc123",
    now,
  });
  assert.equal(result.configurationReady, true);
  assert.equal(result.readyForDemo, false);
  assert.equal(result.revision, "abc123");
  assert.equal(
    result.checks.find((c) => c.id === "live_acceptance")?.status,
    "unverified",
  );
  assert.equal(result.usage.estimatedCost, null);
  assert.doesNotMatch(
    JSON.stringify(result),
    /model-private-value|voice-private-value|447700900123/,
  );
});
test("readiness blocks active uncertain calls, unapproved recipient and exhausted durable attempt ledger", (t) => {
  const store = new Store(":memory:", key);
  t.after(() => store.close());
  store.put("call", "call-a", {
    id: "call-a",
    status: "uncertain",
    startedAt: now - 2000,
  });
  store.put("call-attempt", "call-a", { startedAt: now - 2000 });
  store.put("call-attempt", "deleted-call", { startedAt: now - 1000 });
  store.put("call-attempt", "yesterday", { startedAt: now - 86400000 });
  const result = buildReadiness({
    config,
    store,
    calendarConnected: true,
    calendarEnabled: true,
    callsConfigured: true,
    pushConfigured: false,
    profilePhoneNumber: "+447700900999",
    dailyCallLimit: 2,
    now,
  });
  assert.equal(result.configurationReady, false);
  assert.equal(result.usage.callAttempts, 2);
  assert.equal(result.usage.remainingCalls, 0);
  assert.equal(
    result.checks.find((c) => c.id === "call_budget")?.status,
    "blocked",
  );
  assert.equal(
    result.checks.find((c) => c.id === "recipient")?.status,
    "needs_setup",
  );
  assert.equal(
    result.checks.find((c) => c.id === "active_calls")?.status,
    "blocked",
  );
});
test("retention defaults to dry-run and preserves unresolved actions, receipts and credentials", (t) => {
  const store = new Store(":memory:", key);
  t.after(() => store.close());
  for (const status of ["completed", "in_progress", "uncertain"]) {
    store.put("call", status, { status });
    store.put("call-audio", status, {
      callId: status,
      expiresAt: now - 2 * 86400000,
      audio: "private audio",
    });
  }
  store.put("call-audio", "recent", {
    callId: "completed",
    expiresAt: now - 1000,
  });
  store.put("push-delivery", "old", {
    status: "accepted",
    createdAt: now - 8 * 86400000,
  });
  store.put("push-delivery", "pending", {
    status: "pending",
    createdAt: now - 8 * 86400000,
  });
  for (const kind of [
    "action",
    "secret",
    "session",
    "gmail_draft_action",
    "calendar_action",
    "pairing-ticket",
    "paired-device",
    "call-attempt",
  ])
    store.put(kind, "keep", { status: "uncertain", expiresAt: 0 });
  const dry = cleanupEphemeral(store, { now });
  assert.equal(dry.applied, false);
  assert.equal(dry.candidates, 2);
  assert.equal(store.list("call-audio").length, 4);
  const applied = cleanupEphemeral(store, { now, apply: true });
  assert.deepEqual(applied.counts, { "call-audio": 1, "push-delivery": 1 });
  assert.equal(store.list("call-audio").length, 3);
  assert.equal(store.list("push-delivery").length, 1);
  for (const kind of [
    "action",
    "secret",
    "session",
    "gmail_draft_action",
    "calendar_action",
    "pairing-ticket",
    "paired-device",
    "call-attempt",
  ])
    assert.ok(store.get(kind, "keep"));
  assert.equal(cleanupEphemeral(store, { now, apply: true }).candidates, 0);
});
test("online encrypted backup and restoration preserve committed WAL records and reject overwrite or wrong key", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "jolly-backup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "source.sqlite"),
    backup = join(dir, "backup.sqlite"),
    restored = join(dir, "restore.sqlite");
  const store = new Store(source, key);
  t.after(() => store.close());
  store.put("session", "private", {
    messages: ["Secret private booking context"],
  });
  store.put("secret", "google", { accessToken: "private-oauth-token" });
  store.put("call", "uncertain", {
    status: "uncertain",
    callSid: "private-provider-id",
  });
  const result = await createEncryptedBackup(source, backup, key);
  assert.equal(result.records, 3);
  assert.equal(statSync(backup).mode & 0o777, 0o600);
  assert.doesNotMatch(
    readFileSync(backup).toString(),
    /Secret private booking|private-oauth-token/,
  );
  store.put("session", "new", { value: "after snapshot" });
  await restoreEncryptedBackup(backup, restored, key);
  const recovered = new Store(restored, key);
  try {
    assert.equal(recovered.list("session").length, 1);
    assert.deepEqual(recovered.get("call", "uncertain"), {
      status: "uncertain",
      callSid: "private-provider-id",
    });
    assert.deepEqual(recovered.get("secret", "google"), {
      accessToken: "private-oauth-token",
    });
  } finally {
    recovered.close();
  }
  await assert.rejects(
    () => restoreEncryptedBackup(backup, source, key),
    /already exists/,
  );
  await assert.rejects(() =>
    restoreEncryptedBackup(backup, join(dir, "wrong.sqlite"), "c".repeat(64)),
  );
  assert.equal(store.list("session").length, 2);
});
