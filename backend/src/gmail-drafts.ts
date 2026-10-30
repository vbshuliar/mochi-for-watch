import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { Store } from "./store.ts";
import type { Connection } from "./connections.ts";
import { externalJson } from "./http.ts";
import { email, gmailDraftInputSchema } from "./gmail-draft-schema.ts";
export { gmailDraftInputSchema } from "./gmail-draft-schema.ts";
export type GmailDraftAction = z.infer<typeof gmailDraftInputSchema> & {
  id: string;
  sessionId: string;
  status:
    | "pending"
    | "executing"
    | "completed"
    | "cancelled"
    | "expired"
    | "uncertain";
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  draftId?: string;
  url?: string;
};
type Saved = GmailDraftAction & {
  epoch: string;
  messageId: string;
  from?: string;
};
const kind = "gmail_draft_action";
const providerId = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[a-zA-Z0-9_-]+$/);
const canonical = (s: string) => s.replace(/\r\n|\r|\n/g, "\r\n");
function subjectHeader(subject: string) {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character) > 42) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((part) => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`)
    .join("\r\n ");
}
function mime(action: Saved) {
  const body = Buffer.from(canonical(action.body))
    .toString("base64")
    .match(/.{1,76}/g)!
    .join("\r\n");
  return `From: ${action.from}\r\nTo: ${action.to}\r\nSubject: ${subjectHeader(action.subject)}\r\nMessage-ID: ${action.messageId}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${body}`;
}
function matches(raw: string, action: Saved) {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const separator = /\r?\n\r?\n/.exec(text);
  if (!separator) return false;
  const headers = new Map<string, string>();
  for (const line of text
    .slice(0, separator.index)
    .replace(/\r?\n[ \t]+/g, " ")
    .split(/\r?\n/)) {
    const split = line.indexOf(":");
    if (split < 1) return false;
    const name = line.slice(0, split).toLowerCase();
    if (headers.has(name)) return false;
    headers.set(name, line.slice(split + 1).trim());
  }
  if (
    ["cc", "bcc", "resent-to", "resent-cc", "resent-bcc"].some((name) =>
      headers.has(name),
    )
  )
    return false;
  const subject = (headers.get("subject") ?? "")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, encoded: string) =>
      Buffer.from(encoded, "base64").toString("utf8"),
    );
  const body = text.slice(separator.index + separator[0].length);
  return (
    headers.get("message-id") === action.messageId &&
    headers.get("to") === action.to &&
    headers.get("from") === action.from &&
    subject === action.subject &&
    /^text\/plain;\s*charset="?utf-8"?$/i.test(
      headers.get("content-type") ?? "",
    ) &&
    headers.get("content-transfer-encoding")?.toLowerCase() === "base64" &&
    Buffer.from(body, "base64").toString("utf8") === canonical(action.body)
  );
}
export class GmailDrafts {
  private decisions = new Set<string>();
  constructor(
    private config: Config,
    private store: Store,
    private gmail: Connection,
  ) {
    for (const { value } of store.list<Saved>(kind))
      if (value.status === "executing") {
        value.status = "uncertain";
        this.save(value);
      }
  }
  status() {
    return {
      gmailDraftsConfigured:
        this.config.APP_MODE === "live" && this.gmail.canDraft(),
    };
  }
  private public(action: Saved): GmailDraftAction {
    const {
      epoch: _epoch,
      messageId: _messageId,
      from: _from,
      ...result
    } = action;
    return result;
  }
  private save(action: Saved) {
    action.updatedAt = Date.now();
    this.store.put(kind, action.id, action);
  }
  private permission() {
    if (this.config.APP_MODE !== "live")
      throw new AppError(
        409,
        "live_required",
        "Gmail drafts require live mode.",
      );
    if (!this.gmail.canDraft())
      throw new AppError(
        409,
        "gmail_draft_permission_required",
        "Enable Gmail draft access on your iPhone first. Mochi only saves drafts and never sends email.",
      );
    return this.gmail.epoch()!;
  }
  prepare(sessionId: string, input: unknown): GmailDraftAction {
    z.uuid().parse(sessionId);
    const parsed = gmailDraftInputSchema.parse(input);
    const epoch = this.permission();
    for (const { value } of this.store.list<Saved>(kind)) {
      if (
        value.epoch !== epoch ||
        value.to !== parsed.to ||
        value.subject !== parsed.subject ||
        value.body !== parsed.body
      )
        continue;
      if (["executing", "uncertain"].includes(value.status))
        throw new AppError(
          409,
          "draft_save_uncertain",
          "Review the earlier draft save before creating another copy.",
        );
      if (
        value.sessionId === sessionId &&
        value.status === "pending" &&
        value.expiresAt > Date.now()
      )
        return this.public(value);
    }
    const id = randomUUID();
    const now = Date.now();
    const action: Saved = {
      ...parsed,
      id,
      sessionId,
      epoch,
      messageId: `<mochi-${id}@mochi-for-watch.invalid>`,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 600000,
    };
    this.save(action);
    return this.public(action);
  }
  private action(sessionId: string, id: string) {
    const action = this.store.get<Saved>(kind, id);
    if (!action || action.sessionId !== sessionId)
      throw new AppError(404, "draft_not_found", "Draft review not found.");
    if (action.status === "pending" && action.expiresAt <= Date.now()) {
      action.status = "expired";
      this.save(action);
    }
    return action;
  }
  get(sessionId: string, id: string) {
    return this.public(this.action(sessionId, id));
  }
  list() {
    return this.store
      .list<Saved>(kind)
      .map(({ value }) => this.get(value.sessionId, value.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 100);
  }
  private assertEpoch(action: Saved) {
    if (this.gmail.epoch() !== action.epoch)
      throw new AppError(
        409,
        "connection_changed",
        "Gmail connection changed. Review this draft in the original account.",
      );
  }
  private async verify(action: Saved, id: string) {
    const draft = z
      .object({
        id: providerId,
        message: z.object({
          raw: z.string().max(100000),
          labelIds: z.array(z.string()).optional(),
        }),
      })
      .parse(
        await externalJson(
          await this.gmail.request(
            `drafts/${encodeURIComponent(id)}?format=raw`,
          ),
        ),
      );
    this.assertEpoch(action);
    if (
      draft.id !== id ||
      (draft.message.labelIds && !draft.message.labelIds.includes("DRAFT")) ||
      !matches(draft.message.raw, action)
    )
      throw new AppError(
        409,
        "draft_unverified",
        "The saved draft could not be verified. Check Gmail before trying again.",
      );
    action.draftId = id;
    action.url = "https://mail.google.com/mail/#drafts";
    action.status = "completed";
    this.save(action);
    return this.public(action);
  }
  private async reconcile(action: Saved) {
    if (action.draftId) return this.verify(action, action.draftId);
    const query = new URLSearchParams({
      q: `rfc822msgid:${action.messageId}`,
      maxResults: "2",
    });
    const found = z
      .object({
        drafts: z.array(z.object({ id: providerId })).default([]),
        nextPageToken: z.string().optional(),
      })
      .parse(await externalJson(await this.gmail.request(`drafts?${query}`)));
    this.assertEpoch(action);
    if (found.drafts.length !== 1 || found.nextPageToken)
      throw new AppError(
        409,
        "draft_save_uncertain",
        "Gmail has not confirmed this draft. Check Gmail; Mochi will not create another copy.",
      );
    return this.verify(action, found.drafts[0]!.id);
  }
  async decide(sessionId: string, id: string, decision: "confirm" | "cancel") {
    z.enum(["confirm", "cancel"]).parse(decision);
    if (this.decisions.has(id))
      throw new AppError(
        409,
        "draft_busy",
        "This draft is already being saved.",
      );
    this.decisions.add(id);
    try {
      const action = this.action(sessionId, id);
      if (action.status === "completed" && decision === "confirm")
        return this.public(action);
      if (decision === "cancel") {
        if (!["pending", "cancelled"].includes(action.status))
          throw new AppError(
            409,
            "draft_closed",
            "This draft can no longer be cancelled here. Check Gmail if its save is uncertain.",
          );
        action.status = "cancelled";
        this.save(action);
        return this.public(action);
      }
      if (["expired", "cancelled", "completed"].includes(action.status))
        throw new AppError(
          409,
          "draft_closed",
          "This draft review is closed. Prepare a new draft.",
        );
      this.permission();
      this.assertEpoch(action);
      if (["executing", "uncertain"].includes(action.status))
        return await this.reconcile(action);
      const profile = z
        .object({ emailAddress: email })
        .parse(await externalJson(await this.gmail.request("profile")));
      this.assertEpoch(action);
      action.from = profile.emailAddress;
      action.status = "executing";
      // Persist the write intent before the request. A crash or ambiguous response
      // may only reconcile by Message-ID, never repeat the draft creation.
      this.save(action);
      try {
        const draft = z.object({ id: providerId }).parse(
          await externalJson(
            await this.gmail.request("drafts", {
              method: "POST",
              body: JSON.stringify({
                message: {
                  raw: Buffer.from(mime(action)).toString("base64url"),
                },
              }),
            }),
          ),
        );
        this.assertEpoch(action);
        action.draftId = draft.id;
        this.save(action);
        return await this.verify(action, draft.id);
      } catch (error) {
        action.status = "uncertain";
        this.save(action);
        throw error;
      }
    } finally {
      this.decisions.delete(id);
    }
  }
  assertDeletable(sessionId: string) {
    if (
      this.store
        .list<Saved>(kind)
        .some(
          ({ value }) =>
            value.sessionId === sessionId &&
            ["executing", "uncertain"].includes(value.status),
        )
    )
      throw new AppError(
        409,
        "draft_save_uncertain",
        "Resolve the uncertain Gmail save before deleting this conversation.",
      );
  }
  deleteSession(sessionId: string) {
    this.assertDeletable(sessionId);
    for (const { value } of this.store.list<Saved>(kind))
      if (value.sessionId === sessionId) this.store.delete(kind, value.id);
  }
}
