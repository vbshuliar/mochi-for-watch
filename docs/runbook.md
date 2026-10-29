# Release and operations runbook

This procedure updates the existing private backend. It does not provision a new public multi-user service. See [private deployment](private-deployment.md) for account-specific history and [operations/readiness](operations-readiness.md) for backup mechanics.

## Before release

1. Inspect the branch, remote, working tree and current deployment. Keep unrelated edits out of the commit and build context.
2. Run the root AGENTS validation contract: format, inspect diff, `check:all`; build native SDK targets for native changes.
3. Commit intended changes, push, and wait for both GitHub Checks jobs on the exact SHA. Fix failures before claiming CI passed.
4. Run authenticated read-only preflight against the intended backend. Check no active or uncertain call, preserve the existing encryption key and database, and create a volume snapshot before changing the machine.
5. Note that a single-machine deployment briefly interrupts traffic. Do not deploy during a call or external write.

With the owner's environment loaded privately:

```sh
BACKEND_URL=https://YOUR-BACKEND.example node backend/scripts/preflight.mjs
```

Use Node's `--env-file` option if needed; do not `cat` private files or put tokens in command arguments. Configuration readiness is not live acceptance.

## Build from committed source

Create a temporary directory outside the working checkout, export the intended commit there with `git archive`, and stage assets in that copy. This prevents unrelated working-tree changes from entering either deployment. Store the exact source SHA as the build revision.

```sh
# In the isolated committed snapshot:
npm --prefix backend ci
npm --prefix backend run website:stage
cd backend
fly config validate
fly deploy --remote-only --ha=false --strategy immediate --build-arg BUILD_REVISION=EXACT_COMMIT_SHA
fly status
fly checks list
```

Replace `EXACT_COMMIT_SHA` with the verified commit. Do not deploy that literal placeholder. The repository's Fly app name is owner-specific; forks must use their own configuration. Keep one writable machine and the existing volume; do not scale this SQLite backend horizontally.

The Docker build expects staged public assets. It intentionally excludes `.env`, local databases and tests. Website staging also updates the isolated HTML's embedded agent guide. The separate public website has its own `website/fly.toml`; deploy from the snapshot's `website/` directory with `fly deploy --remote-only --ha=false` when website content changes. Pushing Git does not deploy either service.

## Verify after deployment

- Fly machine and HTTP health check pass.
- Public `/health` reports the expected revision.
- Authenticated `/v1/status` and `/v1/readiness` succeed; their state is consistent with configured accounts.
- Anonymous `/v1/status` and `/v1/readiness` reject access.
- Public homepage, stylesheet, scripts and agent guide load; no private files are exposed.
- Existing Calendar/Gmail/Notion connections and booking profile survive the restart.
- Record failures separately from unverified physical-device, push and live-call acceptance.

A read-only status check must not place a call, create an appointment, send mail or write a Notion document.

## Backup and rollback

Use Fly volume snapshots as one recovery layer. For application-level verification, build the backend and use `backend/scripts/maintenance.mjs backup SOURCE NEW_PATH` with the matching `ENCRYPTION_KEY` loaded. Verify restoration into a **new** path using `restore BACKUP NEW_PATH`; neither command switches the running service. Keep backups and keys private and separate.

If a release fails, inspect logs without disclosing secrets. Roll back to a previously verified image only after checking data-format compatibility and reconciling in-flight external actions. Do not overwrite the current database with an older copy as a first response: an old copy can lose receipts for calls or appointments that actually happened. A rollback does not reverse external actions.

Retention defaults to dry-run. `maintenance.mjs retention --apply` only prunes eligible ephemeral records described in the operations guide. It is not a complete history-deletion policy.

## Pairing and account changes

Use `pairing.mjs issue`, `list`, and `revoke` with the owner's environment. Codes expire in five minutes; device credentials are revocable and expire after 90 days. Never distribute the owner token as routine setup. OAuth consent and native signing are separate from pairing.

Changing a provider grant does not prove that provider writes work. Gmail and Notion are outside the haircut demonstration. The live rehearsal and device acceptance remain separately authorized operations.
