import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
export class Store {
  private db: DatabaseSync;
  private key: Buffer;
  constructor(path: string, key: string) {
    this.key = Buffer.from(key, "hex");
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));",
    );
  }
  private seal(value: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      "base64",
    );
  }
  private open<T>(value: string): T {
    const bytes = Buffer.from(value, "base64"),
      decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        bytes.subarray(0, 12),
      );
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { value: string } | undefined;
    return row ? this.open<T>(row.value) : undefined;
  }
  put(kind: string, id: string, value: unknown) {
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value",
      )
      .run(kind, id, this.seal(value));
  }
  list<T>(kind: string): Array<{ id: string; value: T }> {
    return (
      this.db
        .prepare("SELECT id,value FROM records WHERE kind=?")
        .all(kind) as { id: string; value: string }[]
    ).map((r) => ({ id: r.id, value: this.open<T>(r.value) }));
  }
  delete(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
